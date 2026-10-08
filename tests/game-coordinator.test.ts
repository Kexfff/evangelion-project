import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../electron/store";
import { GameCoordinator, conditionsMet } from "../electron/game-coordinator";
import { gameGoalConfigSchema } from "../src/shared/game-goals";
import { MINECRAFT_ID, minecraftTools } from "../src/shared/minecraft";

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((f) => f());
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "eva-goals-")),
    store = new Store(dir);
  const live: any = {
    connected: true,
    status: "Connected",
    dimension: "overworld",
    position: { x: 0, y: 64, z: 0 },
    inventory: [],
    players: [],
    nearby: [],
    health: 20,
    food: 20,
  };
  const tools = minecraftTools.map((t, i) => ({
    ...t,
    fingerprint: (i + 1).toString(16).padStart(64, "a"),
    policy: "allow",
  }));
  // Fingerprint prefixes must be unique for this fixture's alias mapping.
  tools.forEach(
    (t, i) =>
      (t.fingerprint = i.toString(16).padStart(2, "0") + "a".repeat(62)),
  );
  const decisions: unknown[] = [];
  const intentions: unknown[] = [];
  const runtime: any = {
    store,
    busy: false,
    broadcast: vi.fn(),
    gameOutcome: vi.fn(async () => {}),
    chooseGameActivity: vi.fn(async () =>
      JSON.stringify(
        intentions.shift() ?? {
          decision: "wait",
          seconds: 60,
          reason: "Resting",
        },
      ),
    ),
    autonomy: {
      get config() {
        return store.data.settings.autonomy;
      },
      gameSuspended: false,
      gate: vi.fn(() => "Ready"),
      reserveGameAction: vi.fn(),
      log: vi.fn(),
    },
    planGame: vi.fn(async () =>
      JSON.stringify(
        decisions.shift() ?? { decision: "blocked", reason: "Need materials." },
      ),
    ),
  };
  const minecraft: any = { snapshot: () => ({ live }), stopAction: vi.fn() };
  let calls = 0;
  const mcp: any = {
    snapshot: () => ({ servers: [{ config: { id: MINECRAFT_ID }, tools }] }),
    execute: vi.fn(async (alias: string, args: any) => {
      const tool = tools.find(
        (t) => alias === `mcp_${MINECRAFT_ID}_${t.fingerprint.slice(0, 16)}`,
      );
      if (!tool || tool.policy === "deny") return { error: "Denied" };
      let value: any;
      if (tool.name === "observe")
        value = {
          ...live,
          inspectedBlocks: (args.positions ?? []).map((p: any) => ({
            position: p,
            name: null,
          })),
        };
      else if (
        ["inspect_inventory", "get_recipes", "find_blocks"].includes(tool.name)
      )
        value = { items: [] };
      else {
        const id = `job-${++calls}`;
        live.job = {
          id,
          status: "running",
          startedAt: new Date().toISOString(),
          detail: "Working",
        };
        value = { jobId: id };
      }
      return {
        untrustedToolResult: {
          content: [{ type: "text", text: JSON.stringify(value) }],
        },
      };
    }),
  };
  const game = new GameCoordinator(runtime, minecraft, mcp);
  cleanups.push(() => {
    game.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  const submit = (patch = {}) =>
    game.submit(
      {
        objective: "Make a stone pickaxe",
        completion: [{ kind: "inventory", item: "stone_pickaxe", count: 1 }],
        ...patch,
      },
      {
        characterId: store.characterId,
        sessionId: store.sessionId,
        channel: "desktop",
      },
    );
  const step = (
    tool = "craft_item",
    args = { item: "stone_pickaxe", count: 1 },
  ) =>
    decisions.push({
      decision: "step",
      tool,
      args,
      reason: "Craft the target.",
    });
  const goal = () => store.data.minecraft.goals.at(-1)!;
  return {
    store,
    live,
    tools,
    decisions,
    intentions,
    runtime,
    minecraft,
    mcp,
    game,
    submit,
    step,
    goal,
  };
}

describe("Gameplay depth", () => {
  it("requires matched successful worker evidence for sleep, not current sleep state", async () => {
    const f = fixture();
    f.submit({ objective: "Sleep tonight", completion: [{ kind: "sleep" }] });
    f.live.sleeping = true;
    f.decisions.push({
      decision: "step",
      tool: "sleep",
      args: {},
      reason: "Use the bed",
    });
    await f.game.tick();
    expect(f.goal().status).toBe("running");
    f.live.job.status = "succeeded";
    f.live.job.kind = "sleep";
    f.live.job.result = { outcome: "sleeping" };
    f.live.sleeping = false;
    await f.game.tick();
    expect(f.goal().status).toBe("completed");
    expect(f.goal().history.at(-1)?.evidence).toEqual({ kind: "sleep" });
  });
  it("does not treat another target or lost tracking as confirmed defeat", async () => {
    const uuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const f = fixture();
    f.submit({
      objective: "Defeat that zombie",
      completion: [{ kind: "defeat", entityUuid: uuid }],
    });
    f.decisions.push({
      decision: "step",
      tool: "attack_entity",
      args: { entityId: 2, mode: "fight" },
      reason: "Fight",
    });
    await f.game.tick();
    f.live.job.status = "succeeded";
    f.live.job.kind = "combat";
    f.live.job.result = {
      outcome: "dead",
      entityUuid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    };
    await f.game.tick();
    expect(f.goal().status).not.toBe("completed");
    expect(conditionsMet([{ kind: "defeat", entityUuid: uuid }], f.live)).toBe(
      false,
    );
    expect(
      conditionsMet([{ kind: "defeat", entityUuid: uuid }], f.live, [
        {
          tool: "attack_entity",
          args: {},
          outcome: "Death confirmed",
          evidence: { kind: "defeat", entityUuid: uuid },
        },
      ]),
    ).toBe(true);
  });
  it("binds combat to observed UUIDs and retains verified events after history pruning", async () => {
    const f = fixture(),
      uuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    f.live.nearby = [
      { id: 2, uuid, name: "zombie", position: { x: 1, y: 64, z: 0 } },
    ];
    f.submit({
      completion: [
        { kind: "defeat", entityUuid: uuid },
        { kind: "inventory", item: "stone_pickaxe", count: 1 },
      ],
    });
    f.decisions.push({
      decision: "step",
      tool: "attack_entity",
      args: { entityId: 2, mode: "fight" },
      reason: "Fight",
    });
    await f.game.tick();
    expect(f.mcp.execute.mock.calls.at(-1)?.[1]).toMatchObject({
      entityId: 2,
      entityUuid: uuid,
    });
    Object.assign(f.live.job, {
      status: "succeeded",
      kind: "combat",
      result: { outcome: "dead", entityUuid: uuid },
    });
    f.decisions.push({ decision: "wait", seconds: 1, reason: "Wait" });
    await f.game.tick();
    expect(f.goal().verifiedEvents).toEqual([
      { kind: "defeat", entityUuid: uuid },
    ]);
    f.store.update((d) => {
      d.minecraft.goals.at(-1)!.history = [];
      d.minecraft.goals.at(-1)!.wakeAt = 0;
    });
    f.live.inventory = [{ name: "stone_pickaxe", count: 1 }];
    await f.game.tick();
    expect(f.goal().status).toBe("completed");
  });
  it("persists independent projects, isolates world scope and links verified outcomes", async () => {
    const f = fixture();
    const input = {
      title: "Starter tools",
      objective: "Make a pickaxe",
      targets: [{ item: "stone_pickaxe", count: 1 }],
    };
    const p = f.game.saveProject(input);
    expect(f.store.data.minecraft.projects).toHaveLength(1);
    f.submit({ projectId: p.id });
    expect(() => f.submit({ projectId: p.id })).toThrow(
      "already has an active goal",
    );
    f.live.inventory = [{ name: "stone_pickaxe", count: 1 }];
    await f.game.tick();
    expect(f.store.data.minecraft.projects[0].lastVerifiedAt).toBeTruthy();
    const paused = f.game.saveProject({ ...input, id: p.id, status: "paused" });
    expect(paused.lastOutcome).toContain("completed");
    expect(() => f.submit({ projectId: p.id })).toThrow("active project");
    f.live.dimension = "the_nether";
    expect(() => f.game.saveProject({ ...input, id: p.id })).toThrow(
      "another character or world",
    );
    expect(f.store.data.minecraft.projects[0].targets).toEqual(input.targets);
    const restored = new Store(path.dirname(f.store.file));
    expect(restored.data.minecraft.projects[0]).toMatchObject({
      id: p.id,
      status: "paused",
      targets: input.targets,
    });
  });
  it("makes only active projects from this world available to independent planning", async () => {
    const f = fixture();
    const p = f.game.saveProject({
      title: "Home",
      objective: "Collect wood",
      targets: [{ item: "oak_log", count: 16 }],
    });
    f.game.configureAutonomy({ ...f.game.director.config, enabled: true });
    await f.game.tick();
    expect(
      f.runtime.chooseGameActivity.mock.calls[0][0].projects,
    ).toMatchObject([{ id: p.id }]);
    f.game.saveProject({
      id: p.id,
      title: p.title,
      objective: p.objective,
      targets: p.targets,
      status: "paused",
    });
    f.game.director.change((s) => {
      s.nextDecisionAt = 0;
    });
    await f.game.tick();
    expect(f.runtime.chooseGameActivity.mock.calls.at(-1)[0].projects).toEqual(
      [],
    );
  });
});

describe("Independent Minecraft director", () => {
  const intention = (item = "oak_log", count = 4) => ({
    decision: "goal",
    objective: `Keep ${count} ${item}`,
    completion: [{ kind: "inventory", item, count }],
  });
  const enable = (f: ReturnType<typeof fixture>) =>
    f.game.configureAutonomy({
      ...f.game.director.config,
      enabled: true,
      intervalSeconds: 10,
    });
  const ready = (f: ReturnType<typeof fixture>) =>
    f.store.update((d) => {
      d.minecraft.autonomy.nextDecisionAt = 0;
    });

  it("migrates old profiles with free play off, keeping opt-in reactions and schedules", () => {
    const f = fixture();
    expect(f.game.director.config.enabled).toBe(false);
    expect(f.game.director.state.charges).toEqual([]);
    expect(f.store.data.minecraft.goalConfig).toMatchObject({
      survival: false,
      scheduled: false,
    });
  });
  it("chooses and verifies multiple intentions with companion consciousness disabled and paused", async () => {
    const f = fixture();
    enable(f);
    f.store.update((d) => {
      d.settings.autonomy.enabled = false;
      d.settings.autonomy.paused = true;
    });
    f.runtime.autonomy.gate.mockReturnValue("Quiet hours");
    f.intentions.push(intention(), intention("cobblestone", 3));
    await f.game.tick();
    expect(f.goal()).toMatchObject({ source: "autonomous", status: "queued" });
    f.step("collect_blocks", { block: "oak_log", count: 4 } as any);
    await f.game.tick();
    f.live.job.status = "succeeded";
    f.live.inventory = [{ name: "oak_log", count: 4 }];
    await f.game.tick();
    expect(f.goal().status).toBe("completed");
    expect(f.game.director.state.memories[0]).toMatchObject({
      status: "completed",
      inventory: f.live.inventory,
    });
    ready(f);
    await f.game.tick();
    f.step("collect_blocks", { block: "stone", count: 3 } as any);
    await f.game.tick();
    f.live.job.status = "succeeded";
    f.live.inventory.push({ name: "cobblestone", count: 3 });
    await f.game.tick();
    expect(
      f.store.data.minecraft.goals.every((g) => g.status === "completed"),
    ).toBe(true);
    expect(f.game.director.state.session.requests).toBe(4);
    expect(f.runtime.autonomy.gate).not.toHaveBeenCalled();
    expect(f.runtime.gameOutcome).not.toHaveBeenCalled();
  });
  it("Stop stays stopped across ticks and restart until explicit Resume", async () => {
    const f = fixture();
    enable(f);
    f.intentions.push(intention());
    await f.game.tick();
    f.game.cancelAll();
    ready(f);
    await f.game.tick();
    expect(f.runtime.chooseGameActivity).toHaveBeenCalledOnce();
    expect(f.goal().status).toBe("cancelled");
    const restart = new GameCoordinator(f.runtime, f.minecraft, f.mcp);
    await restart.tick();
    expect(restart.director.config.paused).toBe(true);
    restart.pauseAutonomy(false);
    f.intentions.push(intention());
    await restart.tick();
    expect(f.runtime.chooseGameActivity).toHaveBeenCalledTimes(2);
    restart.stop();
  });
  it("yields a physical autonomous action to a user goal, then re-observes the intention", async () => {
    const f = fixture();
    enable(f);
    f.intentions.push(intention());
    await f.game.tick();
    const id = f.goal().id;
    f.step();
    await f.game.tick();
    f.submit();
    expect(f.store.data.minecraft.goals.find((g) => g.id === id)).toMatchObject(
      { status: "queued", jobId: undefined },
    );
    f.live.job = undefined;
    f.live.inventory = [{ name: "stone_pickaxe", count: 1 }];
    await f.game.tick();
    expect(f.goal().status).toBe("completed");
    f.step();
    await f.game.tick();
    expect(f.store.data.minecraft.goals.find((g) => g.id === id)?.status).toBe(
      "running",
    );
  });
  it("fences direct tool I/O while preserving queued autonomous intent", async () => {
    const f = fixture();
    enable(f);
    f.intentions.push(intention());
    await f.game.tick();
    f.step();
    await f.game.tick();
    const done = f.game.beginManual("open_container");
    f.live.job = undefined;
    await f.game.tick();
    expect(f.runtime.planGame).toHaveBeenCalledOnce();
    done();
    f.step();
    await f.game.tick();
    expect(f.runtime.planGame).toHaveBeenCalledTimes(2);
  });
  it("foreground chat aborts a pending choice without creating a late goal", async () => {
    const f = fixture();
    enable(f);
    let resolve!: (v: string) => void;
    f.runtime.chooseGameActivity.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const pending = f.game.tick();
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    f.runtime.busy = true;
    f.game.foreground();
    resolve(JSON.stringify(intention()));
    await pending;
    expect(f.store.data.minecraft.goals).toHaveLength(0);
    expect(f.game.director.state.session.requests).toBe(1);
    ready(f);
    await f.game.tick();
    expect(f.runtime.chooseGameActivity).toHaveBeenCalledOnce();
  });
  it("normal chat threads do not cancel physical autonomous work or rebind old notifications", async () => {
    const f = fixture();
    enable(f);
    f.intentions.push(intention());
    await f.game.tick();
    f.step();
    await f.game.tick();
    const originalSession = f.goal().sessionId;
    vi.spyOn(f.store, "sessionId", "get").mockReturnValue("new-thread");
    f.game.foreground();
    await f.game.tick();
    expect(f.goal().status).toBe("running");
    expect(f.goal().sessionId).toBe(originalSession);
    f.live.job.status = "succeeded";
    f.live.inventory = [{ name: "oak_log", count: 4 }];
    await f.game.tick();
    expect(f.goal().status).toBe("completed");
    expect((f.mcp.execute.mock.calls.at(-1) as unknown[])[2]).toMatchObject({
      sessionId: "new-thread",
    });
  });
  it("world changes abort in-flight selection and require explicit resume", async () => {
    const f = fixture();
    enable(f);
    let resolve!: (v: string) => void;
    f.runtime.chooseGameActivity.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const pending = f.game.tick();
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    f.live.dimension = "the_nether";
    f.minecraft.onState(f.live);
    resolve(JSON.stringify(intention()));
    await pending;
    expect(f.game.director.config.paused).toBe(true);
    expect(f.store.data.minecraft.goals).toHaveLength(0);
  });
  it("disconnect never selects work; manual reconnection starts fresh without replay", async () => {
    const f = fixture();
    enable(f);
    f.intentions.push(intention());
    await f.game.tick();
    f.live.connected = false;
    f.minecraft.onState(f.live);
    await f.game.tick();
    expect(f.goal().status).toBe("cancelled");
    expect(f.runtime.chooseGameActivity).toHaveBeenCalledOnce();
    f.live.connected = true;
    ready(f);
    f.intentions.push(intention("bread", 2));
    await f.game.tick();
    expect(f.goal().objective).toBe("Keep 2 bread");
  });
  it("system lock pauses gameplay and unlocking does not silently resume", async () => {
    const f = fixture();
    enable(f);
    f.intentions.push(intention());
    await f.game.tick();
    f.game.suspend(true);
    f.game.suspend(false);
    ready(f);
    await f.game.tick();
    expect(f.goal().status).toBe("paused");
    expect(f.game.director.config.paused).toBe(true);
    f.game.pauseAutonomy(false);
    f.step();
    await f.game.tick();
    expect(f.goal().status).toBe("running");
  });
  it("turning activity selection off stops its work but leaves manual goals usable", async () => {
    const f = fixture();
    enable(f);
    f.intentions.push(intention());
    await f.game.tick();
    f.game.configureAutonomy({ ...f.game.director.config, enabled: false });
    expect(f.goal().status).toBe("paused");
    f.submit();
    f.step();
    await f.game.tick();
    expect(f.goal().status).toBe("running");
  });
  it("counts selection and execution across goals and preserves rolling usage on restart", async () => {
    const f = fixture();
    enable(f);
    f.game.configureAutonomy({ ...f.game.director.config, hourlyRequests: 2 });
    f.intentions.push(intention());
    await f.game.tick();
    f.step();
    await f.game.tick();
    f.live.job.status = "succeeded";
    f.live.inventory = [{ name: "oak_log", count: 4 }];
    await f.game.tick();
    ready(f);
    await f.game.tick();
    expect(f.runtime.chooseGameActivity).toHaveBeenCalledOnce();
    expect(f.game.director.state.detail).toContain("Rolling-hour");
    const restart = new GameCoordinator(f.runtime, f.minecraft, f.mcp);
    await restart.tick();
    expect(f.runtime.chooseGameActivity).toHaveBeenCalledOnce();
    expect(restart.director.state.session.requests).toBe(0);
    expect(restart.director.state.charges).toHaveLength(2);
    restart.stop();
  });
  it("reported cost/token exhaustion prevents dispatching a selected goal", async () => {
    for (const usage of [{ cost: 3 }, { tokens: 300000 }]) {
      const f = fixture();
      enable(f);
      f.runtime.chooseGameActivity.mockImplementation(
        async (
          _ctx: unknown,
          _signal: unknown,
          collect: (u: unknown) => void,
        ) => {
          collect(usage);
          return JSON.stringify(intention());
        },
      );
      await f.game.tick();
      expect(f.store.data.minecraft.goals).toHaveLength(0);
      expect(f.game.director.state.detail).toContain("budget reached");
    }
  });
  it("backoffs malformed responses/outages without polling the provider", async () => {
    const f = fixture();
    enable(f);
    f.runtime.chooseGameActivity.mockResolvedValue("not json");
    await f.game.tick();
    await f.game.tick();
    expect(f.runtime.chooseGameActivity).toHaveBeenCalledOnce();
    expect(f.game.director.state.failures).toBe(1);
    ready(f);
    f.runtime.chooseGameActivity.mockRejectedValue(
      new Error("Provider unavailable"),
    );
    await f.game.tick();
    expect(f.game.director.state.nextDecisionAt).toBeGreaterThan(
      Date.now() + 59000,
    );
  });
  it("does not repeatedly select already-satisfied goals or request Ask tools", async () => {
    const f = fixture();
    enable(f);
    f.live.inventory = [{ name: "oak_log", count: 4 }];
    f.intentions.push(intention());
    await f.game.tick();
    expect(f.store.data.minecraft.goals).toHaveLength(0);
    ready(f);
    f.intentions.push(intention("stone_pickaxe", 1));
    await f.game.tick();
    f.tools.find((t) => t.name === "craft_item")!.policy = "ask";
    f.step();
    await f.game.tick();
    expect(f.goal().status).toBe("failed");
    expect(f.goal().detail).toContain("Ask/Blocked");
    expect(
      f.mcp.execute.mock.calls.every(
        (call: unknown[]) => call[0] === f.game.alias("observe"),
      ),
    ).toBe(true);
  });
  it("denied observation waits without asking or spending a provider request", async () => {
    const f = fixture();
    enable(f);
    f.tools.find((t) => t.name === "observe")!.policy = "deny";
    await f.game.tick();
    expect(f.runtime.chooseGameActivity).not.toHaveBeenCalled();
    expect(f.game.director.state.detail).toContain("observation");
  });
  it("shares budgets with manual goals but leaves deterministic survival available", async () => {
    const f = fixture();
    f.game.configureAutonomy({ ...f.game.director.config, hourlyRequests: 0 });
    f.submit();
    await f.game.tick();
    expect(f.runtime.planGame).not.toHaveBeenCalled();
    f.game.cancelAll();
    f.game.pauseAutonomy(false);
    f.store.update((d) => {
      d.minecraft.goalConfig.survival = true;
      d.settings.autonomy.paused = true;
    });
    f.live.food = 8;
    f.live.inventory = [{ name: "bread", count: 1 }];
    await f.game.tick();
    expect(f.goal().currentTool).toBe("eat_food");
  });
  it("retains a paused intention until resumed or cancelled, not a new competing project", async () => {
    const f = fixture();
    enable(f);
    f.intentions.push(intention());
    await f.game.tick();
    f.game.control({ id: f.goal().id, action: "pause" });
    ready(f);
    await f.game.tick();
    expect(f.runtime.chooseGameActivity).toHaveBeenCalledOnce();
    expect(f.game.director.state.detail).toContain("intention is paused");
  });
  it("urgent hunger preempts navigation, waiting for worker cancellation before eating", async () => {
    const f = fixture();
    f.submit();
    f.step("move_to", { x: 10, y: 64, z: 0 } as any);
    await f.game.tick();
    f.store.update((d) => {
      d.minecraft.goalConfig.survival = true;
    });
    f.live.food = 4;
    f.live.inventory = [{ name: "bread", count: 2 }];
    f.live.job.kind = "move";
    await f.game.tick();
    expect(f.goal().status).toBe("queued");
    await f.game.tick();
    expect(f.store.data.minecraft.goals).toHaveLength(1);
    f.live.job.status = "cancelled";
    f.runtime.busy = true;
    await f.game.tick();
    expect(f.goal().currentTool).toBe("eat_food");
    expect(f.runtime.planGame).toHaveBeenCalledOnce();
  });
  it("preserves provider backoff during a stream of world updates", async () => {
    const f = fixture();
    enable(f);
    f.runtime.chooseGameActivity.mockRejectedValue(new Error("Offline"));
    await f.game.tick();
    const wakeAt = f.game.director.state.nextDecisionAt;
    f.live.food = 19;
    f.minecraft.onState(f.live);
    await f.game.tick();
    expect(f.game.director.state.nextDecisionAt).toBe(wakeAt);
    expect(f.runtime.chooseGameActivity).toHaveBeenCalledOnce();
  });
});

describe("Minecraft goal coordinator", () => {
  it("aborts a pending plan immediately when a dimension change arrives", async () => {
    const f = fixture();
    f.submit();
    let resolve!: (value: string) => void;
    f.runtime.planGame.mockImplementation(
      () =>
        new Promise<string>((r) => {
          resolve = r;
        }),
    );
    const turn = f.game.tick();
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    f.live.dimension = "the_nether";
    f.minecraft.onState(f.live);
    resolve(
      JSON.stringify({
        decision: "step",
        tool: "move_to",
        args: { x: 1, y: 64, z: 1 },
        reason: "Late plan",
      }),
    );
    await turn;
    expect(f.goal().status).toBe("paused");
    expect(f.mcp.execute).toHaveBeenCalledOnce();
  });
  it("does not rewrite verified success when an optional notification fails", async () => {
    const f = fixture();
    f.store.update((d) => {
      d.minecraft.goalConfig.notify = true;
    });
    f.runtime.gameOutcome.mockRejectedValue(new Error("Channel unavailable"));
    f.live.inventory = [{ name: "stone_pickaxe", count: 1 }];
    f.submit();
    await f.game.tick();
    expect(f.goal().status).toBe("completed");
    expect(f.runtime.gameOutcome).toHaveBeenCalledOnce();
  });
  it("does not let a gated scheduled goal starve a normal user goal", async () => {
    const f = fixture();
    f.store.update((d) => {
      d.minecraft.goalConfig.scheduled = true;
    });
    const scheduled = f.submit({
      dueAt: new Date(Date.now() + 60000).toISOString(),
    });
    f.store.update((d) => {
      d.minecraft.goals[0].dueAt = new Date(Date.now() - 1000).toISOString();
    });
    f.runtime.autonomy.gate.mockReturnValue("Cooldown");
    f.submit({ objective: "Do this now" });
    f.step();
    await f.game.tick();
    expect(f.goal().status).toBe("running");
    expect(
      f.store.data.minecraft.goals.find((g) => g.id === scheduled.goalId)
        ?.status,
    ).toBe("queued");
  });
  it("allows explicit replacement even when the active queue is full", () => {
    const f = fixture();
    for (let n = 0; n < 16; n++) f.submit();
    expect(() => f.submit()).toThrow("16 active goals");
    f.submit({ mode: "replace" });
    expect(
      f.store.data.minecraft.goals.filter((g) => g.status === "queued"),
    ).toHaveLength(1);
  });
  it("bounds a hung action and stops it before failing the goal", async () => {
    const f = fixture();
    f.submit();
    f.step();
    await f.game.tick();
    f.live.job.startedAt = new Date(Date.now() - 100000).toISOString();
    await f.game.tick();
    expect(f.goal()).toMatchObject({
      status: "failed",
      detail: expect.stringContaining(
        "craft_item stalled: no observed progress for 100s (limit 90s",
      ),
    });
    expect(f.minecraft.stopAction).toHaveBeenCalledWith(false);
  });
  it("allows a long action making progress, then stops after 90 seconds without progress", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const f = fixture();
    f.submit();
    f.step();
    await f.game.tick();
    for (let i = 1; i <= 4; i++) {
      vi.setSystemTime(Date.now() + 60000);
      f.live.job.lastProgressAt = new Date().toISOString();
      f.live.job.progressDetail = `Crafted ${i} operations.`;
      f.live.job.progress = i;
      await f.game.tick();
      expect(f.goal().status).toBe("running");
    }
    vi.setSystemTime(Date.now() + 91000);
    f.live.job.updatedAt = new Date().toISOString();
    f.live.job.detail = "Heartbeat/status changed, not progress";
    await f.game.tick();
    expect(f.goal().detail).toContain("no observed progress for 91s");
    expect(f.goal().detail).toContain("4 action units completed");
    expect(f.goal().detail).toContain("Crafted 4 operations");
    expect(f.goal().history.at(-1)?.outcome).toBe(f.goal().detail);
  });
  it("keeps the overall goal deadline even when action progress is fresh", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const f = fixture();
    f.store.update((d) => {
      d.minecraft.goalConfig.maxMinutes = 1;
    });
    f.submit();
    f.step();
    await f.game.tick();
    vi.setSystemTime(Date.now() + 61000);
    f.live.job.lastProgressAt = new Date().toISOString();
    await f.game.tick();
    expect(f.goal().status).toBe("failed");
    expect(f.goal().detail).toContain("Goal time budget reached");
  });
  it("does not trust invalid or future progress timestamps to extend a stalled action", async () => {
    for (const lastProgressAt of [
      "bad-date",
      new Date(Date.now() + 86400000).toISOString(),
    ]) {
      const f = fixture();
      f.submit();
      f.step();
      await f.game.tick();
      f.live.job.startedAt = new Date(Date.now() - 100000).toISOString();
      f.live.job.lastProgressAt = lastProgressAt;
      await f.game.tick();
      expect(f.goal().status).toBe("failed");
    }
  });
  it("saves per-table reasons in failed goal history, including an interrupted approach", async () => {
    const f = fixture();
    f.submit();
    f.step();
    await f.game.tick();
    f.live.job.diagnostics = [
      {
        position: { x: 1, y: 64, z: 2 },
        startedAt: new Date().toISOString(),
        elapsedMs: 5000,
        outcome: "search_timeout",
      },
      {
        position: { x: 4, y: 64, z: 2 },
        startedAt: new Date().toISOString(),
        elapsedMs: 0,
        outcome: "approaching",
      },
    ];
    f.live.job.startedAt = new Date(Date.now() - 100000).toISOString();
    await f.game.tick();
    expect(
      f
        .goal()
        .history.at(-1)
        ?.diagnostics?.map((d) => d.outcome),
    ).toEqual(["search_timeout", "interrupted"]);
    expect(f.goal().history.at(-1)?.args).toEqual({
      item: "stone_pickaxe",
      count: 1,
    });
  });
  it("passes the Telegram source and active character through every MCP step", async () => {
    const f = fixture();
    f.game.submit(
      {
        objective: "Gather wood",
        completion: [{ kind: "inventory", item: "oak_log", count: 16 }],
      },
      {
        characterId: f.store.characterId,
        sessionId: f.store.sessionId,
        channel: "telegram",
      },
    );
    f.step();
    await f.game.tick();
    for (const call of f.mcp.execute.mock.calls)
      expect((call as unknown[])[2]).toEqual({
        characterId: f.store.characterId,
        sessionId: f.store.sessionId,
        channel: "telegram",
      });
  });
  it("replans a failed navigation step with another waypoint, not an identical retry", async () => {
    const f = fixture();
    f.submit();
    f.step("move_to", { x: 4, y: 64, z: 0 } as any);
    await f.game.tick();
    f.live.job.status = "failed";
    f.live.job.kind = "move";
    f.live.job.detail = "No walkable route.";
    f.step("move_to", { x: 2, y: 64, z: 2 } as any);
    await f.game.tick();
    expect(f.goal()).toMatchObject({
      status: "running",
      recoveries: 1,
      jobId: "job-2",
    });
    f.live.job.status = "failed";
    f.live.job.kind = "move";
    f.step("move_to", { x: 2, y: 64, z: 2 } as any);
    await f.game.tick();
    expect(f.goal()).toMatchObject({ status: "failed" });
    expect(f.goal().detail).toContain("repeated a failed route");
  });
  it("does not replan uncertain partial building or a lost combat target", async () => {
    for (const kind of ["build", "combat"]) {
      const f = fixture();
      f.submit();
      f.step();
      await f.game.tick();
      Object.assign(f.live.job, {
        status: "failed",
        kind,
        detail: "Partial or untracked outcome.",
      });
      await f.game.tick();
      expect(f.goal().status).toBe("failed");
      expect(f.runtime.planGame).toHaveBeenCalledOnce();
    }
  });
  it("cost usage accumulates across requests and prevents another mutation", async () => {
    const f = fixture();
    f.submit();
    f.runtime.planGame.mockImplementation(
      async (
        _g: unknown,
        _o: unknown,
        _t: unknown,
        _s: unknown,
        usage: (u: unknown) => void,
      ) => {
        usage({ cost: 0.6, tokens: 500 });
        return JSON.stringify({
          decision: "step",
          tool: "craft_item",
          args: { item: "stone_pickaxe", count: 1 },
          reason: "Craft",
        });
      },
    );
    await f.game.tick();
    expect(f.goal()).toMatchObject({
      status: "failed",
      cost: 0.6,
      tokens: 500,
    });
    expect(f.mcp.execute).toHaveBeenCalledTimes(1);
  });
  it("pauses all queued work on disconnect and does not silently restart it", async () => {
    const f = fixture();
    f.submit();
    f.live.connected = false;
    f.minecraft.onState(f.live);
    expect(f.goal().status).toBe("paused");
    f.live.connected = true;
    await f.game.tick();
    expect(f.runtime.planGame).not.toHaveBeenCalled();
  });
  it("a food reaction yields only at a completed step boundary and then returns to the goal", async () => {
    const f = fixture();
    f.submit();
    f.step();
    await f.game.tick();
    f.store.update((d) => {
      d.minecraft.goalConfig.survival = true;
      d.settings.autonomy.enabled = true;
      d.settings.autonomy.quietEnabled = false;
    });
    f.live.food = 8;
    f.live.inventory = [{ name: "bread", count: 3 }];
    await f.game.tick();
    expect(f.store.data.minecraft.goals).toHaveLength(1);
    f.live.job.status = "succeeded";
    await f.game.tick();
    expect(f.store.data.minecraft.goals[0].status).toBe("queued");
    await f.game.tick();
    expect(f.goal().currentTool).toBe("eat_food");
    f.live.job.status = "succeeded";
    f.live.food = 20;
    await f.game.tick();
    expect(f.goal().status).toBe("completed");
    f.live.inventory.push({ name: "stone_pickaxe", count: 1 });
    await f.game.tick();
    expect(f.store.data.minecraft.goals[0].status).toBe("completed");
  });
  it("does not use a blocked reaction tool or retaliate against guessed attackers", async () => {
    const f = fixture();
    f.store.update((d) => {
      d.minecraft.goalConfig.survival = true;
      d.settings.autonomy.enabled = true;
      d.settings.autonomy.quietEnabled = false;
    });
    f.live.food = 8;
    f.live.inventory = [{ name: "bread", count: 1 }];
    f.tools.find((t) => t.name === "eat_food")!.policy = "deny";
    f.live.health = 10;
    f.live.nearby = [{ id: 6, name: "zombie", type: "hostile" }];
    await f.game.tick();
    expect(f.store.data.minecraft.goals).toHaveLength(0);
    expect(f.mcp.execute).not.toHaveBeenCalled();
  });
  it("waits for verified action completion and then checks actual inventory", async () => {
    const f = fixture();
    f.submit();
    f.step();
    await f.game.tick();
    expect(f.goal()).toMatchObject({
      status: "running",
      steps: 1,
      requests: 1,
      jobId: "job-1",
    });
    await f.game.tick();
    expect(f.runtime.planGame).toHaveBeenCalledOnce();
    f.live.job.status = "succeeded";
    f.live.inventory = [{ name: "stone_pickaxe", count: 1 }];
    await f.game.tick();
    expect(f.goal().status).toBe("completed");
    expect(f.runtime.planGame).toHaveBeenCalledOnce();
  });
  it("does not equate a successful tool call with completing the goal", async () => {
    const f = fixture();
    f.submit();
    f.step();
    await f.game.tick();
    f.live.job.status = "succeeded";
    await f.game.tick();
    expect(f.goal()).toMatchObject({
      status: "failed",
      detail: "Need materials.",
    });
  });
  it("gathers then crafts on separate completion events", async () => {
    const f = fixture();
    f.submit();
    f.step("collect_blocks", { block: "stone", count: 3 } as any);
    await f.game.tick();
    f.live.job.status = "succeeded";
    f.live.inventory = [{ name: "cobblestone", count: 3 }];
    f.step();
    await f.game.tick();
    expect(f.goal().jobId).toBe("job-2");
    f.live.job.status = "succeeded";
    f.live.inventory.push({ name: "stone_pickaxe", count: 1 });
    await f.game.tick();
    expect(f.goal().status).toBe("completed");
    expect(f.goal().steps).toBe(2);
  });
  it("queues goals without replacing the current action and replaces explicitly", async () => {
    const f = fixture();
    const a = f.submit();
    f.step();
    await f.game.tick();
    f.submit({ objective: "Another pickaxe" });
    expect(
      f.store.data.minecraft.goals.find((g) => g.id === a.goalId)?.status,
    ).toBe("running");
    f.submit({ objective: "Replace it", mode: "replace" });
    expect(
      f.store.data.minecraft.goals
        .slice(0, 2)
        .every((g) => g.status === "cancelled"),
    ).toBe(true);
    expect(f.goal().status).toBe("queued");
  });
  it("chat and read-only observations do not interrupt; direct mutations do", async () => {
    const f = fixture();
    f.submit();
    f.step();
    await f.game.tick();
    f.game.manual("observe");
    expect(f.goal().status).toBe("running");
    f.runtime.busy = true;
    await f.game.tick();
    expect(f.goal().status).toBe("running");
    f.game.manual("move_to");
    expect(f.goal().status).toBe("paused");
  });
  it("cancels pending planning without dispatching a late result", async () => {
    const f = fixture();
    f.submit();
    let release!: (s: string) => void;
    f.runtime.planGame.mockImplementation(
      () => new Promise((r) => (release = r)),
    );
    const pending = f.game.tick();
    await vi.waitFor(() => expect(f.runtime.planGame).toHaveBeenCalled());
    f.game.cancelAll();
    release(
      JSON.stringify({
        decision: "step",
        tool: "dig_block",
        args: {},
        reason: "late",
      }),
    );
    await pending;
    expect(f.goal().status).toBe("cancelled");
    expect(f.mcp.execute).toHaveBeenCalledTimes(1);
  });
  it("pauses on restart and reconciles completed work without replay after resume", async () => {
    const f = fixture();
    f.submit();
    f.step();
    await f.game.tick();
    const restarted = new GameCoordinator(f.runtime, f.minecraft, f.mcp);
    expect(f.goal().status).toBe("paused");
    f.live.job.status = "succeeded";
    f.live.inventory = [{ name: "stone_pickaxe", count: 1 }];
    restarted.control({ id: f.goal().id, action: "resume" });
    await restarted.tick();
    expect(f.goal().status).toBe("completed");
    expect(f.runtime.planGame).toHaveBeenCalledOnce();
  });
  it("rejects resume in another endpoint/dimension and rejects resuming running work", async () => {
    const f = fixture();
    f.submit();
    expect(() => f.game.control({ id: f.goal().id, action: "resume" })).toThrow(
      "paused",
    );
    f.game.pauseAll("Test");
    f.live.dimension = "the_nether";
    expect(() => f.game.control({ id: f.goal().id, action: "resume" })).toThrow(
      "same world",
    );
  });
  it("does not retry a denied/failed action or an interrupted job", async () => {
    const f = fixture();
    f.submit();
    f.step();
    f.tools.find((t) => t.name === "craft_item")!.policy = "deny";
    await f.game.tick();
    expect(f.goal().status).toBe("failed");
    await f.game.tick();
    expect(f.runtime.planGame).toHaveBeenCalledOnce();
  });
  it("verifies completion even when the last step uses the entire budget", async () => {
    const f = fixture();
    f.store.update((d) => (d.minecraft.goalConfig.maxSteps = 1));
    f.submit();
    f.step();
    await f.game.tick();
    f.live.job.status = "succeeded";
    f.live.inventory = [{ name: "stone_pickaxe", count: 1 }];
    await f.game.tick();
    expect(f.goal().status).toBe("completed");
  });
  it("stops further planning at its request budget", async () => {
    const f = fixture();
    f.store.update((d) => (d.minecraft.goalConfig.maxRequests = 1));
    f.submit();
    f.step("inspect_inventory", {} as any);
    await f.game.tick();
    await f.game.tick();
    expect(f.goal().status).toBe("failed");
    expect(f.runtime.planGame).toHaveBeenCalledOnce();
  });
  it("waits for a future wake time without repeated provider calls", async () => {
    const f = fixture();
    f.submit();
    f.decisions.push({ decision: "wait", seconds: 30, reason: "Smelting" });
    await f.game.tick();
    await f.game.tick();
    expect(f.runtime.planGame).toHaveBeenCalledOnce();
    expect(f.goal().detail).toBe("Smelting");
  });
  it("requires scheduling opt-in but ignores companion quiet hours and daily gate", async () => {
    const f = fixture();
    const dueAt = new Date(Date.now() + 60000).toISOString();
    expect(() => f.submit({ dueAt })).toThrow("scheduling");
    f.store.update((d) => {
      d.minecraft.goalConfig.scheduled = true;
      d.settings.autonomy.enabled = true;
      d.settings.autonomy.quietEnabled = false;
    });
    f.submit({ dueAt });
    await f.game.tick();
    expect(f.runtime.planGame).not.toHaveBeenCalled();
    f.store.update(
      (d) =>
        (d.minecraft.goals[0].dueAt = new Date(
          Date.now() - 1000,
        ).toISOString()),
    );
    f.runtime.autonomy.gate.mockReturnValue("Quiet hours");
    f.step();
    await f.game.tick();
    expect(f.goal().status).toBe("running");
    expect(f.runtime.autonomy.reserveGameAction).not.toHaveBeenCalled();
  });
  it("keeps gameplay running when consciousness is paused", async () => {
    const f = fixture();
    f.submit();
    f.step();
    await f.game.tick();
    f.store.update((d) => (d.settings.autonomy.paused = true));
    await f.game.tick();
    expect(f.goal().status).toBe("running");
  });
  it("uses deterministic, opt-in food reactions without asking an LLM", async () => {
    const f = fixture();
    f.live.food = 8;
    f.live.inventory = [{ name: "bread", count: 2 }];
    await f.game.tick();
    expect(f.mcp.execute).not.toHaveBeenCalled();
    f.store.update((d) => {
      d.minecraft.goalConfig.survival = true;
      d.settings.autonomy.enabled = true;
      d.settings.autonomy.quietEnabled = false;
    });
    await f.game.tick();
    expect(f.goal()).toMatchObject({
      source: "survival",
      currentTool: "eat_food",
      status: "running",
    });
    expect(f.runtime.planGame).not.toHaveBeenCalled();
    f.live.job.status = "succeeded";
    f.live.food = 14;
    await f.game.tick();
    expect(f.goal().status).toBe("completed");
    await f.game.tick();
    expect(f.store.data.minecraft.goals).toHaveLength(1);
  });
  it("only completes exact observed conditions, never unloaded blocks", () => {
    const f = fixture();
    const condition: any = [
      { kind: "block", position: { x: 1, y: 64, z: 2 }, block: "stone" },
    ];
    expect(conditionsMet(condition, f.live)).toBe(false);
    expect(
      conditionsMet(condition, {
        ...f.live,
        inspectedBlocks: [{ name: "stone", position: condition[0].position }],
      }),
    ).toBe(true);
    expect(
      conditionsMet(
        [{ kind: "position", position: { x: 100, y: 64, z: 0 }, radius: 3 }],
        f.live,
      ),
    ).toBe(false);
    expect(gameGoalConfigSchema.safeParse({ maxSteps: 0 }).success).toBe(false);
  });
});
