import { randomUUID } from "node:crypto";
import {
  goalInputSchema,
  goalControlSchema,
  plannerDecisionSchema,
  type GameGoal,
  type GoalCondition,
} from "../src/shared/game-goals";
import { MINECRAFT_ID, type MinecraftLive } from "../src/shared/minecraft";
import type { ToolContext, McpToolView } from "../src/shared/mcp";
import type { CompanionRuntime } from "./runtime";
import type { MinecraftPlugin } from "./minecraft-plugin";
import type { McpPlugin } from "./mcp-plugin";
import { quietNow } from "./autonomy";

const reads = new Set([
  "observe",
  "inspect_inventory",
  "find_blocks",
  "get_recipes",
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
export function conditionsMet(conditions: GoalCondition[], state: Observation) {
  if (!state.connected) return false;
  return conditions.every((c) => {
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
  private timer?: ReturnType<typeof setInterval>;
  private controller?: AbortController;
  private working = false;
  private lastCharge = Date.now();
  private lastReaction = 0;
  private lastHealth?: number;
  private hurt = false;
  private stopping = false;
  constructor(
    private runtime: CompanionRuntime,
    private minecraft: MinecraftPlugin,
    private mcp: McpPlugin,
  ) {
    const store = runtime.store;
    if (
      store.data.minecraft.goals.some((g) =>
        ["running", "queued"].includes(g.status),
      )
    )
      store.update((d) => {
        for (const g of d.minecraft.goals)
          if (["running", "queued"].includes(g.status)) {
            g.status = "paused";
            g.detail =
              "App restarted. Confirm the world and resume to inspect before continuing; partial actions are not replayed.";
            delete g.jobId;
          }
      });
    minecraft.onState = (state) => {
      if (
        state.connected &&
        this.goals.some(
          (g) =>
            ["running", "queued"].includes(g.status) &&
            (g.world !== this.world() ||
              g.characterId !== store.characterId ||
              g.sessionId !== store.sessionId),
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
  cancelAll() {
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
    else if (!reads.has(name))
      this.pauseAll(
        "Paused for a direct game instruction. Resume to re-observe before continuing.",
      );
  }
  submit(
    raw: unknown,
    context: ToolContext,
    source: GameGoal["source"] = context.channel,
  ) {
    const input = goalInputSchema.parse(raw),
      live = this.minecraft.snapshot().live;
    if (
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
    if (input.mode === "replace") this.cancelAll();
    const now = new Date().toISOString();
    const goal: GameGoal = {
      id: randomUUID(),
      objective: input.objective,
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
      g.sessionId !== this.runtime.store.sessionId
    ) {
      this.pauseAll("World or conversation changed. Confirm before resuming.");
      throw new Error("Goal context changed.");
    }
    const alias = this.alias(name);
    if (!alias) throw new Error("A required Minecraft tool is unavailable.");
    const result = (await this.mcp.execute(
      alias,
      args,
      {
        characterId: g.characterId,
        sessionId: g.sessionId,
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
    this.update(g, { status, detail: detail.slice(0, 600), jobId: undefined });
    this.runtime.autonomy.log(
      `game-${status}`,
      `${g.objective}: ${detail}`,
      {},
      g.characterId,
    );
    if (this.config.notify && this.runtime.autonomy.gate() === "Ready") {
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
      this.runtime.autonomy.gate() !== "Ready" ||
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
      this.pauseAll("Coordinator error. Inspect the world before resuming.");
    } finally {
      this.working = false;
    }
  }
  private async advance() {
    let g = this.goals.find((g) => g.status === "running");
    const live = this.minecraft.snapshot().live;
    if (
      g &&
      (!live.connected ||
        g.world !== this.world() ||
        g.characterId !== this.runtime.store.characterId ||
        g.sessionId !== this.runtime.store.sessionId)
    ) {
      this.pauseAll(
        "World, connection or conversation changed. Confirm before resuming.",
      );
      return;
    }
    if (
      this.runtime.autonomy.config.paused ||
      this.runtime.autonomy.gameSuspended
    ) {
      if (g) this.pauseAll("Gameplay paused by consciousness or system lock.");
      return;
    }
    if (!live.connected) return;
    if (
      g &&
      (g.dueAt || g.source === "survival") &&
      (!this.runtime.autonomy.config.enabled ||
        quietNow(Date.now(), this.runtime.autonomy.config) ||
        (g.dueAt && !this.config.scheduled) ||
        (g.source === "survival" && !this.config.survival))
    ) {
      this.pauseAll(
        "Autonomous gameplay is disabled or in quiet hours. Resume explicitly when ready.",
      );
      return;
    }
    if (!g) {
      if (live.job?.status === "running") return;
      this.reaction(live);
      g = [...this.goals]
        .sort(
          (a, b) =>
            Number(b.source === "survival") - Number(a.source === "survival"),
        )
        .find(
          (g) =>
            g.status === "queued" &&
            g.characterId === this.runtime.store.characterId &&
            g.sessionId === this.runtime.store.sessionId &&
            g.world === this.world() &&
            (!g.dueAt ||
              (this.config.scheduled && Date.parse(g.dueAt) <= Date.now())) &&
            (g.source !== "survival" || this.config.survival) &&
            (!(g.dueAt || g.source === "survival") ||
              this.runtime.autonomy.gate() === "Ready"),
        );
      if (!g) return;
      if (
        (g.dueAt || g.source === "survival") &&
        this.runtime.autonomy.gate() !== "Ready"
      )
        return;
      this.update(g, {
        status: "running",
        detail: "Inspecting current world state.",
      });
      this.lastCharge = Date.now();
      if (g.dueAt || g.source === "survival")
        this.runtime.autonomy.reserveGameAction();
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
        if (
          Date.now() - Date.parse(job.startedAt) >
          this.config.stepSeconds * 1000
        ) {
          this.minecraft.stopAction(false);
          await this.finish(
            g,
            "failed",
            "Step time limit reached; effects may be partial.",
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
          jobId: undefined,
          history: [
            ...g.history.slice(-63),
            { tool: g.currentTool ?? "unknown", args: {}, outcome: job.detail },
          ],
          elapsedMs,
        });
    }
    if (this.runtime.busy) return;
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
      if (conditionsMet(g.completion, observation)) {
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
        const available =
          this.mcp
            .snapshot()
            .servers.find((s) => s.config.id === MINECRAFT_ID)
            ?.tools.filter(
              (t) => t.policy !== "deny" && !forbidden.has(t.name),
            ) ?? [];
        this.update(g, { requests: g.requests + 1, elapsedMs });
        const output = await this.runtime.planGame(
          g,
          observation,
          available,
          signal,
          (usage) => {
            this.update(g!, {
              cost: g!.cost + (usage.cost ?? 0),
              tokens: g!.tokens + (usage.tokens ?? 0),
            });
          },
        );
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
      this.update(g, {
        steps: g.steps + 1,
        currentTool: decision.tool,
        detail: decision.reason,
        wakeAt: undefined,
        elapsedMs,
      });
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
              : JSON.stringify(result).slice(0, 600),
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
      if (this.controller === c) this.controller = undefined;
    }
  }
}
