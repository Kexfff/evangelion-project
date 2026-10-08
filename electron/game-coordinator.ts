import { randomUUID } from "node:crypto";
import {
  goalInputSchema,
  goalControlSchema,
  plannerDecisionSchema,
  gameProjectInputSchema,
  type GameGoal,
  type GoalCondition,
} from "../src/shared/game-goals";
import { MINECRAFT_ID, type MinecraftLive } from "../src/shared/minecraft";
import type { ToolContext } from "../src/shared/mcp";
import type { CompanionRuntime } from "./runtime";
import type { MinecraftPlugin } from "./minecraft-plugin";
import type { McpPlugin } from "./mcp-plugin";
import { GameDirector } from "./game-director";
import { directorDecisionSchema } from "../src/shared/game-autonomy";

const reads = new Set([
  "observe",
  "inspect_inventory",
  "find_blocks",
  "get_recipes",
  "plan_resources",
  "locate_player",
  "job_status",
]);
const forbidden = new Set(["follow_player", "stop_action", "say_in_game"]);
const safeFoods = new Set([
  "bread",
  "cooked_beef",
  "cooked_porkchop",
  "cooked_chicken",
  "cooked_mutton",
  "cooked_salmon",
  "baked_potato",
  "golden_carrot",
]);
type Observation = MinecraftLive & {
  inspectedBlocks?: {
    name: string | null;
    position: { x: number; y: number; z: number };
  }[];
};
export function conditionsMet(
  conditions: GoalCondition[],
  state: Observation,
  history: GameGoal["history"] = [],
  verified: GoalCondition[] = [],
) {
  if (!state.connected) return false;
  return conditions.every((c) => {
    if (c.kind === "sleep")
      return (
        verified.some((e) => e.kind === "sleep") ||
        history.some((h) => h.evidence?.kind === "sleep")
      );
    if (c.kind === "defeat")
      return (
        verified.some(
          (e) => e.kind === "defeat" && e.entityUuid === c.entityUuid,
        ) ||
        history.some(
          (h) =>
            h.evidence?.kind === "defeat" &&
            h.evidence.entityUuid === c.entityUuid,
        )
      );
    if (c.kind === "inventory")
      return (
        state.inventory
          .filter((i) => i.name === c.item)
          .reduce((n, i) => n + i.count, 0) >= c.count
      );
    if (c.kind === "food") return (state.food ?? -1) >= c.minimum;
    if (c.kind === "position")
      return (
        !!state.position &&
        Math.hypot(
          state.position.x - c.position.x,
          state.position.y - c.position.y,
          state.position.z - c.position.z,
        ) <= c.radius
      );
    return (
      state.inspectedBlocks?.some(
        (b) =>
          b.name === c.block &&
          b.position.x === c.position.x &&
          b.position.y === c.position.y &&
          b.position.z === c.position.z,
      ) ?? false
    );
  });
}

/** Main-process goals own intent; the worker retains exclusive physical-action
 * ownership. Every step still passes through the normal MCP grants/audit layer.
 */
export class GameCoordinator {
  saveProject(raw: unknown) {
    const input = gameProjectInputSchema.parse(raw);
    const store = this.runtime.store;
    const previous = input.id
      ? store.data.minecraft.projects.find(
          (p) =>
            p.id === input.id &&
            p.characterId === store.characterId &&
            p.world === this.world(),
        )
      : undefined;
    if (input.id && !previous)
      throw new Error("Project belongs to another character or world.");
    if (!this.minecraft.snapshot().live.connected)
      throw new Error("Join the project's world before editing it.");
    if (!previous && store.data.minecraft.projects.length >= 100)
      throw new Error("Project storage is full (100 records).");
    if (new Set(input.targets.map((t) => t.item)).size !== input.targets.length)
      throw new Error("Use one target per item.");
    const now = new Date().toISOString();
    const project = {
      ...previous,
      ...input,
      id: previous?.id ?? randomUUID(),
      characterId: store.characterId,
      world: this.world(),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      lastVerifiedAt:
        previous &&
        JSON.stringify(previous.targets) === JSON.stringify(input.targets)
          ? previous.lastVerifiedAt
          : undefined,
    };
    store.update((d) => {
      d.minecraft.projects = [
        ...d.minecraft.projects.filter((p) => p.id !== project.id),
        project,
      ];
    });
    this.runtime.broadcast();
    return project;
  }
  private timer?: ReturnType<typeof setInterval>;
  private controller?: AbortController;
  private working = false;
  private lastCharge = Date.now();
  private lastReaction = 0;
  private lastHealth?: number;
  private hurt = false;
  private stopping = false;
  private suspended = false;
  private scope?: string;
  private planning = false;
  private manualActions = 0;
  private worldSignal = "";
  private lastEventWake = 0;
  readonly director: GameDirector;
  constructor(
    private runtime: CompanionRuntime,
    private minecraft: MinecraftPlugin,
    private mcp: McpPlugin,
  ) {
    this.director = new GameDirector(runtime);
    const store = runtime.store;
    if (
      store.data.minecraft.goals.some(
        (g) =>
          ["running", "queued"].includes(g.status) ||
          (g.source === "autonomous" && g.status === "paused"),
      )
    )
      store.update((d) => {
        for (const g of d.minecraft.goals)
          if (
            ["running", "queued"].includes(g.status) ||
            (g.source === "autonomous" && g.status === "paused")
          ) {
            g.status = g.source === "autonomous" ? "cancelled" : "paused";
            g.detail =
              "App restarted. Confirm the world and resume to inspect before continuing; partial actions are not replayed.";
            delete g.jobId;
          }
      });
    minecraft.onState = (state) => {
      this.checkScope(state);
      const signature = JSON.stringify([
        state.connected,
        state.health,
        state.food,
        state.inventory,
        Math.floor((state.timeOfDay ?? 0) / 6000),
        state.players,
        state.playerLocations?.map((p) => [
          p.name,
          p.source,
          p.position && [
            Math.floor(p.position.x / 16),
            Math.floor(p.position.y / 8),
            Math.floor(p.position.z / 16),
          ],
        ]),
      ]);
      if (signature !== this.worldSignal) {
        this.worldSignal = signature;
        // Coalesce meaningful changes, never physics ticks. Failed decisions keep their backoff.
        if (
          !this.director.state.failures &&
          Date.now() - this.lastEventWake >=
            this.director.config.intervalSeconds * 1000
        ) {
          this.lastEventWake = Date.now();
          if (
            this.director.state.nextDecisionAt >
            Date.now() + this.director.config.intervalSeconds * 1000
          )
            this.director.waiting(
              "World conditions changed; considering the next activity.",
            );
        }
      }
      if (
        state.connected &&
        this.goals.some(
          (g) =>
            ["running", "queued"].includes(g.status) &&
            (g.world !== this.world() ||
              g.characterId !== store.characterId ||
              (g.source !== "autonomous" && g.sessionId !== store.sessionId)),
        )
      )
        this.pauseAll(
          "World or conversation changed. Confirm before resuming.",
        );
      if (
        !state.connected &&
        this.goals.some((g) => ["running", "queued"].includes(g.status))
      )
        this.pauseAll("Connection ended. Confirm the world before resuming.");
      if (!state.connected)
        for (const g of this.goals.filter(
          (g) => g.source === "autonomous" && g.status === "paused",
        ))
          this.update(g, {
            status: "cancelled",
            detail:
              "Connection ended; partial effects remain. A manual join starts with fresh observation.",
          });
      if (!state.connected) {
        this.lastHealth = undefined;
        this.hurt = false;
      } else if (state.health !== undefined) {
        if (this.lastHealth !== undefined && state.health < this.lastHealth)
          this.hurt = true;
        this.lastHealth = state.health;
      }
      void this.tick();
    };
    minecraft.onStop = () => this.cancelAll();
  }
  get goals() {
    return this.runtime.store.data.minecraft.goals;
  }
  private get config() {
    return this.runtime.store.data.minecraft.goalConfig;
  }
  private world() {
    const c = this.runtime.store.data.minecraft.config;
    return JSON.stringify([
      c.host,
      c.port,
      c.worldId,
      c.username,
      this.minecraft.snapshot().live.dimension,
    ]);
  }
  private checkScope(live: MinecraftLive) {
    const scope = JSON.stringify([
      this.runtime.store.characterId,
      this.world(),
    ]);
    if (!live.connected) {
      this.controller?.abort();
      this.scope = undefined;
    } else if (this.scope && this.scope !== scope) {
      this.pauseAutonomy(
        true,
        "Character, world or account changed. Resume gameplay explicitly.",
      );
      this.pauseAll("World ownership changed. Inspect before resuming.");
      this.scope = scope;
    } else this.scope = scope;
  }
  configureAutonomy(raw: unknown) {
    const wasEnabled = this.director.config.enabled;
    const wasPaused = this.director.config.paused;
    this.director.configure(raw);
    if (this.planning) this.controller?.abort();
    if (this.director.config.paused)
      this.pauseAutomatic("Independent gameplay paused.");
    else if (wasEnabled && !this.director.config.enabled)
      this.pauseAutomatic("Self-selected gameplay disabled.", true);
    else if (wasPaused) this.pauseAutonomy(false);
  }
  pauseAutonomy(
    paused: boolean,
    reason = "Independent gameplay paused by user.",
  ) {
    this.director.change((s) => {
      s.config.paused = paused;
      s.detail = paused
        ? reason
        : "Resumed. Observing before choosing the next activity.";
      s.nextDecisionAt = 0;
    });
    if (paused) this.pauseAutomatic(reason);
    else if (this.minecraft.snapshot().live.connected)
      for (const g of this.goals.filter(
        (g) =>
          g.source === "autonomous" &&
          g.status === "paused" &&
          g.characterId === this.runtime.store.characterId &&
          g.world === this.world(),
      ))
        this.update(g, {
          status: "queued",
          jobId: undefined,
          wakeAt: undefined,
          detail: "Gameplay resumed; re-observing before continuing.",
        });
  }
  suspend(value: boolean) {
    this.suspended = value;
    if (value) {
      this.pauseAutonomy(
        true,
        "System locked or suspended. Resume gameplay explicitly.",
      );
      this.pauseAll("System locked or suspended. Resume explicitly.");
    }
  }
  private pauseAutomatic(reason: string, selfSelectedOnly = false) {
    if (this.planning) this.controller?.abort();
    for (const g of this.goals.filter(
      (g) =>
        ["running", "queued"].includes(g.status) &&
        (g.source === "autonomous" ||
          (!selfSelectedOnly && (g.source === "survival" || !!g.dueAt))),
    )) {
      if (g.status === "running") {
        this.controller?.abort();
        this.minecraft.stopAction(false);
      }
      this.update(g, { status: "paused", detail: reason, jobId: undefined });
    }
  }
  /** Foreground chat wins provider time, but never cancels physical movement. */
  foreground() {
    if (this.planning) this.controller?.abort();
  }
  private yieldAutonomous() {
    if (this.planning) this.controller?.abort();
    for (const g of this.goals.filter(
      (g) => g.source === "autonomous" && g.status === "running",
    )) {
      this.controller?.abort();
      this.minecraft.stopAction(false);
      this.update(g, {
        status: "queued",
        jobId: undefined,
        wakeAt: undefined,
        detail: "Yielding to the user. Will re-observe before continuing.",
      });
    }
  }
  beginManual(name: string) {
    this.manualActions++;
    this.manual(name);
    return () => {
      this.manualActions--;
    };
  }
  private tool(name: string) {
    return this.mcp
      .snapshot()
      .servers.find((s) => s.config.id === MINECRAFT_ID)
      ?.tools.find((t) => t.name === name);
  }
  alias(name: string) {
    const t = this.tool(name);
    return t && `mcp_${MINECRAFT_ID}_${t.fingerprint.slice(0, 16)}`;
  }
  name(alias: string) {
    return this.mcp
      .snapshot()
      .servers.find((s) => s.config.id === MINECRAFT_ID)
      ?.tools.find(
        (t) => alias === `mcp_${MINECRAFT_ID}_${t.fingerprint.slice(0, 16)}`,
      )?.name;
  }
  private update(g: GameGoal, patch: Partial<GameGoal>) {
    this.runtime.store.update((d) => {
      const goal = d.minecraft.goals.find((v) => v.id === g.id);
      if (goal)
        Object.assign(goal, patch, { updatedAt: new Date().toISOString() });
    });
    Object.assign(g, patch);
    this.runtime.broadcast();
  }
  start() {
    this.stopping = false;
    this.timer ??= setInterval(() => void this.tick(), 1000);
    this.timer.unref();
  }
  stop() {
    this.stopping = true;
    clearInterval(this.timer);
    this.timer = undefined;
    this.pauseAll(
      "Connection/lifecycle changed. Confirm the world before resuming.",
    );
  }
  cancelAll(pauseDirector = true) {
    if (pauseDirector)
      this.pauseAutonomy(
        true,
        "Stopped. Resume independent gameplay when ready.",
      );
    this.controller?.abort();
    this.minecraft.stopAction(false);
    for (const g of this.goals.filter((g) =>
      ["running", "queued", "paused"].includes(g.status),
    ))
      this.update(g, {
        status: "cancelled",
        detail: "Stopped by user; completed changes remain.",
      });
  }
  pauseAll(reason: string) {
    const active = this.goals.filter((g) =>
      ["running", "queued"].includes(g.status),
    );
    this.controller?.abort();
    for (const g of active)
      this.update(g, { status: "paused", detail: reason, jobId: undefined });
    if (active.length) this.minecraft.stopAction(false);
  }
  manual(name: string) {
    if (name === "stop_action") this.cancelAll();
    else if (!reads.has(name)) {
      const autonomous = this.goals
        .filter(
          (g) =>
            g.source === "autonomous" &&
            ["running", "queued"].includes(g.status),
        )
        .map((g) => g.id);
      this.pauseAll(
        "Paused for a direct game instruction. Resume to re-observe before continuing.",
      );
      for (const g of this.goals.filter((g) => autonomous.includes(g.id)))
        this.update(g, { status: "queued", wakeAt: undefined });
    }
  }
  submit(
    raw: unknown,
    context: ToolContext,
    source: GameGoal["source"] = context.channel,
  ) {
    const input = goalInputSchema.parse(raw),
      live = this.minecraft.snapshot().live;
    if (
      !this.runtime.store.data.minecraft.enabled ||
      context.characterId !== this.runtime.store.characterId ||
      context.sessionId !== this.runtime.store.sessionId ||
      !live.connected
    )
      throw new Error(
        "Join the active character's world before creating a goal.",
      );
    if (
      input.dueAt &&
      (!this.config.scheduled ||
        Date.parse(input.dueAt) <= Date.now() ||
        Date.parse(input.dueAt) > Date.now() + 7 * 86400000)
    )
      throw new Error(
        "Enable game scheduling and choose a time within the next seven days.",
      );
    if (
      input.mode !== "replace" &&
      this.goals.filter((g) =>
        ["running", "queued", "paused"].includes(g.status),
      ).length >= 16
    )
      throw new Error(
        "Finish or cancel a goal before adding more (16 active goals maximum).",
      );
    if (
      input.projectId &&
      !this.runtime.store.data.minecraft.projects.some(
        (p) =>
          p.id === input.projectId &&
          p.characterId === context.characterId &&
          p.world === this.world() &&
          p.status === "active",
      )
    )
      throw new Error("Select an active project in this world.");
    if (
      input.projectId &&
      input.mode !== "replace" &&
      this.goals.some(
        (g) =>
          g.projectId === input.projectId &&
          ["queued", "running", "paused"].includes(g.status),
      )
    )
      throw new Error("This project already has an active goal.");
    if (input.mode === "replace") this.cancelAll(false);
    else if ((source === "desktop" || source === "telegram") && !input.dueAt)
      this.yieldAutonomous();
    const now = new Date().toISOString();
    const goal: GameGoal = {
      id: randomUUID(),
      objective: input.objective,
      projectId: input.projectId,
      completion: input.completion,
      status: "queued",
      source,
      ...context,
      world: this.world(),
      dueAt: input.dueAt,
      createdAt: now,
      updatedAt: now,
      detail: input.dueAt
        ? "Scheduled; awaiting authorized wake-up."
        : "Queued",
      steps: 0,
      requests: 0,
      cost: 0,
      tokens: 0,
      elapsedMs: 0,
      recoveries: 0,
      history: [],
    };
    this.runtime.store.update((d) => {
      d.minecraft.goals = [
        ...d.minecraft.goals.filter((g) =>
          ["running", "queued", "paused"].includes(g.status),
        ),
        ...d.minecraft.goals
          .filter((g) => !["running", "queued", "paused"].includes(g.status))
          .slice(-83),
        goal,
      ];
    });
    this.runtime.broadcast();
    return {
      goalId: goal.id,
      status: goal.status,
      instruction:
        "Goal accepted, not completed. Continue normal conversation; the coordinator will handle its steps quietly.",
    };
  }
  control(raw: unknown) {
    const { id, action } = goalControlSchema.parse(raw),
      g = this.goals.find(
        (g) => g.id === id && g.characterId === this.runtime.store.characterId,
      );
    if (!g || !["running", "queued", "paused"].includes(g.status))
      throw new Error("Goal is no longer active.");
    if (action === "resume") {
      if (g.status !== "paused")
        throw new Error("Only a paused goal can be resumed.");
      if (!this.minecraft.snapshot().live.connected || g.world !== this.world())
        throw new Error(
          "Reconnect to the same world, account and dimension before resuming.",
        );
      this.update(g, {
        status: "queued",
        sessionId: this.runtime.store.sessionId,
        jobId: undefined,
        wakeAt: undefined,
        detail: "Resume requested; inspecting current state before planning.",
      });
    } else {
      if (g.status === "running") {
        this.controller?.abort();
        this.minecraft.stopAction(false);
      }
      this.update(g, {
        status: action === "pause" ? "paused" : "cancelled",
        jobId: undefined,
        detail:
          action === "pause"
            ? "Paused by user. Partial effects remain."
            : "Cancelled by user.",
      });
    }
    return { status: action };
  }
  private async call(
    name: string,
    args: Record<string, unknown>,
    g: GameGoal,
    signal: AbortSignal,
  ) {
    if (
      g.world !== this.world() ||
      g.characterId !== this.runtime.store.characterId ||
      (g.source !== "autonomous" &&
        g.sessionId !== this.runtime.store.sessionId)
    ) {
      this.pauseAll("World or conversation changed. Confirm before resuming.");
      throw new Error("Goal context changed.");
    }
    const alias = this.alias(name);
    if (!alias) throw new Error("A required Minecraft tool is unavailable.");
    if (g.source === "autonomous" && this.tool(name)?.policy !== "allow")
      throw new Error(
        "This intention needs an allowed tool. Ask/Blocked tools are left for explicit user instructions.",
      );
    const result = (await this.mcp.execute(
      alias,
      args,
      {
        characterId: g.characterId,
        sessionId:
          g.source === "autonomous"
            ? this.runtime.store.sessionId
            : g.sessionId,
        channel: g.source === "telegram" ? "telegram" : "desktop",
      },
      signal,
    )) as any;
    signal.throwIfAborted();
    if (result.error || result.untrustedToolResult?.isError)
      throw new Error(
        "A tool was denied or failed; its effect may be partial. Inspect before a new request.",
      );
    const text = result.untrustedToolResult?.content
      ?.filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("");
    if (!text || text.length > 24000)
      throw new Error("Invalid game observation.");
    return JSON.parse(text);
  }
  private async observe(
    g: GameGoal,
    signal: AbortSignal,
  ): Promise<Observation> {
    return this.call(
      "observe",
      {
        positions: g.completion
          .filter((c) => c.kind === "block")
          .map((c) => c.position),
      },
      g,
      signal,
    );
  }
  private async finish(
    g: GameGoal,
    status: "completed" | "failed",
    detail: string,
  ) {
    const job = this.minecraft.snapshot().live.job;
    const attempted = [...g.history]
      .reverse()
      .find((h) => h.tool === g.currentTool);
    const history =
      g.jobId && job?.id === g.jobId
        ? [
            ...g.history.slice(-63),
            {
              tool: g.currentTool ?? "unknown",
              args: attempted?.args ?? {},
              outcome: detail.slice(0, 600),
              diagnostics: job.diagnostics?.map((d) =>
                d.outcome === "approaching" && status === "failed"
                  ? {
                      ...d,
                      outcome: "interrupted" as const,
                      elapsedMs: Math.max(
                        0,
                        Date.now() - Date.parse(d.startedAt),
                      ),
                    }
                  : d,
              ),
            },
          ]
        : g.history;
    this.update(g, {
      status,
      detail: detail.slice(0, 600),
      jobId: undefined,
      history,
    });
    this.director.remember(g, this.minecraft.snapshot().live);
    if (g.projectId)
      this.runtime.store.update((d) => {
        const p = d.minecraft.projects.find(
          (p) =>
            p.id === g.projectId &&
            p.world === g.world &&
            p.characterId === g.characterId,
        );
        if (p) {
          p.lastOutcome = `${g.status}: ${g.detail}`.slice(0, 600);
          p.updatedAt = new Date().toISOString();
          if (
            status === "completed" &&
            conditionsMet(
              p.targets.map((t) => ({ kind: "inventory" as const, ...t })),
              this.minecraft.snapshot().live,
            )
          )
            p.lastVerifiedAt = p.updatedAt;
        }
      });
    this.runtime.autonomy.log(
      `game-${status}`,
      `${g.objective}: ${detail}`,
      {},
      g.characterId,
    );
    if (
      g.source === "autonomous"
        ? this.director.config.notify
        : this.config.notify
    ) {
      try {
        await this.runtime.gameOutcome(g, detail);
      } catch {
        this.runtime.autonomy.log(
          "game-notification-failed",
          "Game outcome was saved, but its notification could not be delivered.",
          {},
          g.characterId,
        );
      }
    }
  }
  private reaction(live: MinecraftLive) {
    if (
      !this.config.survival ||
      this.director.config.paused ||
      Date.now() - this.lastReaction <
        this.config.reactionCooldownSeconds * 1000
    )
      return;
    const food = live.inventory.find((i) => safeFoods.has(i.name));
    // Do not interrupt inventory I/O to eat. A subsequent completion event wakes this again.
    if (live.job?.status === "running") return;
    const friend = live.playerLocations?.find(
      (p) =>
        p.source === "tracking" &&
        p.position &&
        p.name === this.runtime.store.data.minecraft.config.trustedPlayer,
    );
    const retreat =
      this.hurt &&
      friend?.position &&
      live.position &&
      Math.hypot(
        friend.position.x - live.position.x,
        friend.position.y - live.position.y,
        friend.position.z - live.position.z,
      ) > 4 &&
      this.tool("move_to")?.policy === "allow";
    const eat =
      (live.food ?? 20) <= 14 &&
      food &&
      this.tool("eat_food")?.policy === "allow";
    if (!eat && !retreat) {
      this.hurt = false;
      return;
    }
    this.lastReaction = Date.now();
    const reaction = this.submit(
      eat
        ? {
            objective: `Eat ${food!.name}${this.hurt ? " after taking damage" : " because hunger is low"}.`,
            completion: [
              { kind: "food", minimum: Math.min(20, (live.food ?? 0) + 1) },
            ],
          }
        : {
            objective:
              "Return to the tracked preferred player after taking damage.",
            completion: [
              { kind: "position", position: friend!.position, radius: 3 },
            ],
          },
      {
        characterId: this.runtime.store.characterId,
        sessionId: this.runtime.store.sessionId,
        channel: "desktop",
      },
      "survival",
    );
    this.hurt = false;
    return reaction.goalId;
  }
  async tick() {
    if (this.working || this.stopping) return;
    this.working = true;
    try {
      await this.advance();
    } catch {
      this.pauseAutonomy(
        true,
        "Coordinator error. Inspect the world before resuming.",
      );
      this.pauseAll("Coordinator error. Inspect the world before resuming.");
    } finally {
      this.working = false;
    }
  }
  private async advance() {
    let g = this.goals.find((g) => g.status === "running");
    const live = this.minecraft.snapshot().live;
    this.checkScope(live);
    if (
      !this.runtime.store.data.minecraft.enabled ||
      this.suspended ||
      this.manualActions
    )
      return;
    // Scope checking can pause the goal synchronously.
    if (g && this.goals.find((v) => v.id === g!.id)?.status !== "running")
      return;
    if (
      g &&
      (!live.connected ||
        g.world !== this.world() ||
        g.characterId !== this.runtime.store.characterId ||
        (g.source !== "autonomous" &&
          g.sessionId !== this.runtime.store.sessionId))
    ) {
      this.pauseAll(
        "World, connection or conversation changed. Confirm before resuming.",
      );
      return;
    }
    if (!live.connected) return;
    if (
      this.runtime.store.data.minecraft.config.characterId !==
      this.runtime.store.characterId
    ) {
      this.pauseAutonomy(
        true,
        "This world belongs to another character. Join the active character's world.",
      );
      this.pauseAll("Character ownership changed.");
      return;
    }
    if (
      g &&
      (g.dueAt || g.source === "survival" || g.source === "autonomous") &&
      (this.director.config.paused ||
        (g.source === "autonomous" && !this.director.config.enabled) ||
        (g.dueAt && !this.config.scheduled) ||
        (g.source === "survival" && !this.config.survival))
    ) {
      this.pauseAll(
        "Independent gameplay is paused or disabled. Resume explicitly when ready.",
      );
      return;
    }
    if (!g) {
      if (live.job?.status === "running") return;
      this.reaction(live);
      g = [...this.goals]
        .sort(
          (a, b) =>
            Number(b.source === "survival") - Number(a.source === "survival") ||
            Number(a.source === "autonomous") -
              Number(b.source === "autonomous") ||
            Number(!!a.dueAt) - Number(!!b.dueAt),
        )
        .find(
          (g) =>
            g.status === "queued" &&
            g.characterId === this.runtime.store.characterId &&
            (g.source === "autonomous" ||
              g.sessionId === this.runtime.store.sessionId) &&
            g.world === this.world() &&
            (!g.dueAt ||
              (this.config.scheduled && Date.parse(g.dueAt) <= Date.now())) &&
            (g.source !== "survival" || this.config.survival) &&
            (g.source !== "autonomous" || this.director.config.enabled) &&
            (!(
              g.dueAt ||
              g.source === "survival" ||
              g.source === "autonomous"
            ) ||
              !this.director.config.paused),
        );
      if (!g) {
        await this.chooseActivity(live);
        return;
      }
      this.update(g, {
        status: "running",
        detail: "Inspecting current world state.",
      });
      this.lastCharge = Date.now();
    }
    const now = Date.now(),
      elapsedMs = g.elapsedMs + now - this.lastCharge;
    this.lastCharge = now;
    this.update(g, { elapsedMs });
    if (elapsedMs >= this.config.maxMinutes * 60000) {
      this.minecraft.stopAction(false);
      await this.finish(
        g,
        "failed",
        "Goal time budget reached. Inspect state before starting a new goal.",
      );
      return;
    }
    if (g.wakeAt && g.wakeAt > now) return;
    if (g.jobId) {
      const job = live.job;
      if (job?.id === g.jobId && job.status === "running") {
        const urgentFood =
          (live.food ?? 20) <= 6 &&
          live.inventory.some((i) => safeFoods.has(i.name)) &&
          this.tool("eat_food")?.policy === "allow";
        const friend = live.playerLocations?.find(
          (p) =>
            p.source === "tracking" &&
            p.name === this.runtime.store.data.minecraft.config.trustedPlayer &&
            p.position,
        );
        const urgentRetreat =
          this.hurt &&
          friend?.position &&
          live.position &&
          Math.hypot(
            friend.position.x - live.position.x,
            friend.position.y - live.position.y,
            friend.position.z - live.position.z,
          ) > 4 &&
          this.tool("move_to")?.policy === "allow";
        if (
          g.source !== "survival" &&
          this.config.survival &&
          !this.director.config.paused &&
          job.kind === "move" &&
          (urgentFood || urgentRetreat) &&
          now - this.lastReaction >= this.config.reactionCooldownSeconds * 1000
        ) {
          this.minecraft.stopAction(false);
          this.update(g, {
            status: "queued",
            jobId: undefined,
            detail:
              "Yielding navigation for an urgent survival reaction; waiting for the worker to stop.",
          });
          return;
        }
        const reportedStart = Date.parse(job.startedAt);
        const startedAt =
          Number.isFinite(reportedStart) && reportedStart <= now
            ? reportedStart
            : now - elapsedMs;
        const reportedProgressAt = Date.parse(
          job.lastProgressAt ?? job.startedAt,
        );
        // Invalid/future timestamps cannot keep a stalled action alive.
        const lastProgressAt =
          Number.isFinite(reportedProgressAt) && reportedProgressAt <= now
            ? Math.max(startedAt, reportedProgressAt)
            : startedAt;
        if (now - lastProgressAt > this.config.stepSeconds * 1000) {
          this.minecraft.stopAction(false);
          await this.finish(
            g,
            "failed",
            `${g.currentTool ?? job.kind ?? "Action"} stalled: no observed progress for ${Math.floor((now - lastProgressAt) / 1000)}s (limit ${this.config.stepSeconds}s; running ${Math.floor((now - startedAt) / 1000)}s; ${job.progress ?? 0} action units completed). Last progress: ${job.progressDetail ?? "none reported"}. Stopped; completed changes remain and final effects may be partial.`,
          );
        }
        return;
      }
      if (
        job?.id === g.jobId &&
        job.status === "failed" &&
        job.kind === "move" &&
        g.recoveries < 2
      ) {
        const attempted = [...g.history]
          .reverse()
          .find((h) => h.tool === g!.currentTool);
        this.update(g, {
          jobId: undefined,
          recoveries: g.recoveries + 1,
          history: [
            ...g.history.slice(-63),
            {
              tool: g.currentTool ?? "move_to",
              args: attempted?.args ?? {},
              outcome: `Failed route: ${job.detail}. Re-observe and choose another waypoint or report a blocker; do not repeat this call.`,
            },
          ],
        });
      } else if (job?.id !== g.jobId || job.status !== "succeeded") {
        await this.finish(
          g,
          "failed",
          job?.detail ?? "Step interrupted; inspect before continuing.",
        );
        return;
      } else
        this.update(g, {
          verifiedEvents: g.completion.filter(
            (c) =>
              (g!.verifiedEvents ?? []).some(
                (e) => JSON.stringify(e) === JSON.stringify(c),
              ) ||
              (c.kind === "sleep" &&
                g!.currentTool === "sleep" &&
                job.kind === "sleep" &&
                job.result?.outcome === "sleeping") ||
              (c.kind === "defeat" &&
                g!.currentTool === "attack_entity" &&
                job.kind === "combat" &&
                job.result?.outcome === "dead" &&
                job.result.entityUuid === c.entityUuid),
          ),
          jobId: undefined,
          history: [
            ...g.history.slice(-63),
            {
              tool: g.currentTool ?? "unknown",
              args: {},
              outcome: job.detail,
              diagnostics: job.diagnostics,
              evidence:
                g.currentTool === "sleep" &&
                job.kind === "sleep" &&
                job.result?.outcome === "sleeping"
                  ? { kind: "sleep" as const }
                  : g.currentTool === "attack_entity" &&
                      job.kind === "combat" &&
                      job.result?.outcome === "dead" &&
                      typeof job.result.entityUuid === "string" &&
                      g.completion.some(
                        (c) =>
                          c.kind === "defeat" &&
                          c.entityUuid === job.result?.entityUuid,
                      )
                    ? {
                        kind: "defeat" as const,
                        entityUuid: job.result.entityUuid,
                      }
                    : undefined,
            },
          ],
          elapsedMs,
        });
    }
    if (this.runtime.busy && g.source !== "survival") return;
    if (
      g.source === "autonomous" &&
      this.goals.some(
        (v) =>
          v.source !== "autonomous" &&
          v.status === "queued" &&
          v.world === this.world() &&
          v.characterId === this.runtime.store.characterId &&
          v.sessionId === this.runtime.store.sessionId &&
          (!v.dueAt ||
            (this.config.scheduled &&
              !this.director.config.paused &&
              Date.parse(v.dueAt) <= Date.now())),
      )
    ) {
      this.update(g, {
        status: "queued",
        detail: "Yielding at a completed action boundary to a user goal.",
      });
      return;
    }
    if (g.source !== "survival" && this.reaction(live)) {
      this.update(g, {
        status: "queued",
        detail: "Yielded at a verified step boundary for a survival reaction.",
      });
      return;
    }
    const c = (this.controller = new AbortController());
    const signal = AbortSignal.any([
      c.signal,
      AbortSignal.timeout(
        Math.max(
          1,
          Math.min(120000, this.config.maxMinutes * 60000 - elapsedMs),
        ),
      ),
    ]);
    try {
      const observation = await this.observe(g, signal);
      if (
        conditionsMet(g.completion, observation, g.history, g.verifiedEvents)
      ) {
        await this.finish(
          g,
          "completed",
          "Goal completed; the requested world/inventory conditions are verified.",
        );
        return;
      }
      if (
        g.cost >= this.config.maxCost ||
        g.steps >= this.config.maxSteps ||
        g.requests >= this.config.maxRequests
      ) {
        await this.finish(
          g,
          "failed",
          "Goal action/request/cost budget reached.",
        );
        return;
      }
      let decision;
      if (g.source === "survival") {
        const destination = g.completion.find((v) => v.kind === "position");
        const food = observation.inventory.find((i) => safeFoods.has(i.name));
        if (!destination && !food)
          throw new Error("No suitable food remains in inventory.");
        decision =
          destination?.kind === "position"
            ? {
                decision: "step" as const,
                tool: "move_to",
                args: destination.position,
                reason: "Returning to the preferred player after damage.",
              }
            : {
                decision: "step" as const,
                tool: "eat_food",
                args: { item: food!.name },
                reason: "Eating to recover hunger.",
              };
      } else {
        const budget = this.director.budget();
        if (budget) {
          this.update(g, { detail: budget, wakeAt: Date.now() + 30000 });
          this.director.waiting(budget, 30);
          return;
        }
        const available =
          this.mcp
            .snapshot()
            .servers.find((s) => s.config.id === MINECRAFT_ID)
            ?.tools.filter(
              (t) =>
                (g!.source === "autonomous"
                  ? t.policy === "allow"
                  : t.policy !== "deny") && !forbidden.has(t.name),
            ) ?? [];
        this.update(g, { requests: g.requests + 1, elapsedMs });
        const charge = this.director.reserve();
        this.planning = true;
        const output = await this.runtime.planGame(
          g,
          observation,
          available,
          signal,
          (usage) => {
            charge(usage);
            this.update(g!, {
              cost: g!.cost + (usage.cost ?? 0),
              tokens: g!.tokens + (usage.tokens ?? 0),
            });
          },
        );
        this.planning = false;
        signal.throwIfAborted();
        decision = plannerDecisionSchema.parse(JSON.parse(output));
      }
      if (decision.decision === "blocked") {
        await this.finish(g, "failed", decision.reason);
        return;
      }
      if (decision.decision === "wait") {
        this.update(g, {
          wakeAt: Date.now() + decision.seconds * 1000,
          detail: decision.reason,
          elapsedMs,
        });
        return;
      }
      if (forbidden.has(decision.tool))
        throw new Error("This action cannot be part of a finite goal.");
      if (
        g.history.some(
          (h) =>
            h.outcome.startsWith("Failed route:") &&
            h.tool === decision.tool &&
            JSON.stringify(h.args) === JSON.stringify(decision.args),
        )
      )
        throw new Error(
          "The planner repeated a failed route instead of choosing an alternative.",
        );
      if (g.cost >= this.config.maxCost)
        throw new Error("Provider-reported cost budget reached.");
      if (g.source !== "survival" && this.director.budget(true))
        throw new Error(this.director.budget(true));
      this.update(g, {
        steps: g.steps + 1,
        currentTool: decision.tool,
        detail: decision.reason,
        wakeAt: undefined,
        elapsedMs,
      });
      if (decision.tool === "attack_entity") {
        const args = decision.args as Record<string, unknown>;
        const target = observation.nearby.find((e) => e.id === args.entityId);
        if (target?.uuid) args.entityUuid = target.uuid;
      }
      const result = await this.call(decision.tool, decision.args, g, signal);
      this.update(g, {
        jobId: result.jobId,
        history: [
          ...g.history.slice(-63),
          {
            tool: decision.tool,
            args: decision.args,
            outcome: result.jobId
              ? "Accepted; waiting for verification."
              : JSON.stringify(result).slice(0, 3000),
          },
        ],
      });
    } catch (error) {
      if (!c.signal.aborted) {
        this.minecraft.stopAction(false);
        await this.finish(
          g,
          "failed",
          error instanceof Error
            ? error.message
            : "Game planning failed; no automatic retry.",
        );
      }
    } finally {
      this.planning = false;
      if (this.controller === c) this.controller = undefined;
    }
  }

  private async chooseActivity(live: MinecraftLive) {
    const d = this.director;
    if (
      !d.config.enabled ||
      d.config.paused ||
      this.runtime.busy ||
      Date.now() < d.state.nextDecisionAt
    )
      return;
    // Never invent another project over an explicitly paused intention.
    if (
      this.goals.some(
        (g) =>
          g.source === "autonomous" &&
          g.status === "paused" &&
          g.world === this.world() &&
          g.characterId === this.runtime.store.characterId,
      )
    ) {
      d.waiting(
        "An intention is paused. Resume or cancel it in Game goals before choosing another.",
      );
      return;
    }
    const budget = d.budget();
    if (budget) {
      d.waiting(budget, 30);
      return;
    }
    if (this.tool("observe")?.policy !== "allow") {
      d.waiting(
        "Allow the observation tool to enable autonomous decisions.",
        60,
      );
      return;
    }
    const c = (this.controller = new AbortController());
    const signal = AbortSignal.any([c.signal, AbortSignal.timeout(60000)]);
    const world = this.world(),
      characterId = this.runtime.store.characterId,
      sessionId = this.runtime.store.sessionId;
    const context = { characterId, sessionId, channel: "desktop" as const };
    try {
      this.planning = true;
      const result = (await this.mcp.execute(
        this.alias("observe")!,
        { positions: [] },
        context,
        signal,
      )) as any;
      signal.throwIfAborted();
      if (result.error || result.untrustedToolResult?.isError)
        throw new Error("Could not observe the world.");
      const text = result.untrustedToolResult?.content
        ?.filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("");
      if (!text || text.length > 24000)
        throw new Error("Invalid game observation.");
      const observation = JSON.parse(text) as Observation;
      if (!observation.connected) throw new Error("World disconnected.");
      const available =
        this.mcp
          .snapshot()
          .servers.find((s) => s.config.id === MINECRAFT_ID)
          ?.tools.filter(
            (t) => t.policy === "allow" && !forbidden.has(t.name),
          ) ?? [];
      d.waiting("Choosing the next useful activity.");
      const charge = d.reserve();
      const output = await this.runtime.chooseGameActivity(
        {
          preference: d.config.preference,
          projects: this.runtime.store.data.minecraft.projects.filter(
            (p) =>
              p.characterId === characterId &&
              p.world === world &&
              p.status === "active",
          ),
          objective: d.config.objective,
          observation,
          observedAt: new Date().toISOString(),
          memories: d.state.memories
            .filter((m) => m.world === world && m.characterId === characterId)
            .slice(-16),
          landmarks: (this.minecraft.snapshot().landmarks ?? []).filter(
            (l) =>
              l.characterId === characterId &&
              l.host === this.runtime.store.data.minecraft.config.host &&
              l.port === this.runtime.store.data.minecraft.config.port &&
              l.worldId === this.runtime.store.data.minecraft.config.worldId &&
              l.dimension === live.dimension,
          ),
          preferredPlayer:
            this.runtime.store.data.minecraft.config.trustedPlayer,
          tools: available.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        },
        signal,
        charge,
      );
      signal.throwIfAborted();
      if (
        world !== this.world() ||
        characterId !== this.runtime.store.characterId ||
        sessionId !== this.runtime.store.sessionId ||
        this.runtime.busy
      ) {
        d.waiting("Context changed; observing again before choosing.");
        return;
      }
      const costLimit = d.budget(true);
      if (costLimit) {
        d.waiting(costLimit, 30);
        return;
      }
      const decision = directorDecisionSchema.parse(JSON.parse(output));
      if (decision.decision === "wait") {
        d.waiting(decision.reason, decision.seconds);
        return;
      }
      if (conditionsMet(decision.completion, observation)) {
        d.failure(
          "That target is already satisfied. Waiting before choosing something useful.",
        );
        return;
      }
      const recentFailure = d.state.memories.some(
        (m) =>
          m.world === world &&
          m.characterId === characterId &&
          m.status === "failed" &&
          Date.parse(m.observedAt) > Date.now() - 600000 &&
          m.objective === decision.objective,
      );
      if (recentFailure) {
        d.failure(
          "Avoiding a recently failed intention. Resources or permissions may need attention.",
        );
        return;
      }
      this.submit(
        {
          objective: decision.objective,
          completion: decision.completion,
          projectId: decision.projectId,
        },
        context,
        "autonomous",
      );
      d.waiting(decision.objective);
    } catch (error) {
      if (!c.signal.aborted)
        d.failure(
          error instanceof Error ? error.message : "Activity selection failed.",
        );
    } finally {
      this.planning = false;
      if (this.controller === c) this.controller = undefined;
    }
  }
}
