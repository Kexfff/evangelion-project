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
  const runtime: any = {
    store,
    busy: false,
    broadcast: vi.fn(),
    gameOutcome: vi.fn(async () => {}),
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
    runtime,
    minecraft,
    mcp,
    game,
    submit,
    step,
    goal,
  };
}

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
      detail: "Step time limit reached; effects may be partial.",
    });
    expect(f.minecraft.stopAction).toHaveBeenCalledWith(false);
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
  it("requires scheduling opt-in and respects the autonomy gate", async () => {
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
    await f.game.tick();
    expect(f.goal().status).toBe("queued");
    f.runtime.autonomy.gate.mockReturnValue("Ready");
    f.step();
    await f.game.tick();
    expect(f.runtime.autonomy.reserveGameAction).toHaveBeenCalledOnce();
  });
  it("pauses gameplay immediately when consciousness is paused", async () => {
    const f = fixture();
    f.submit();
    f.step();
    await f.game.tick();
    f.store.update((d) => (d.settings.autonomy.paused = true));
    await f.game.tick();
    expect(f.goal().status).toBe("paused");
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
