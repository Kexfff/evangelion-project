import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as realDelay } from "node:timers/promises";
import { EventEmitter } from "node:events";
import { Vec3 } from "vec3";
import type { Bot } from "mineflayer";
import {
  MinecraftEngine,
  gameFailureDetail,
  inRadius,
  safeMovements,
} from "../electron/minecraft-engine";
import { MinecraftPlugin } from "../electron/minecraft-plugin";
import { Store } from "../electron/store";
import { compileMcpTool } from "../electron/mcp-plugin";
import {
  minecraftConfigSchema,
  minecraftTools,
  type MinecraftLive,
} from "../src/shared/minecraft";
import type { MinecraftFactory } from "../electron/minecraft-transport";

vi.mock("mineflayer-pathfinder", () => ({
  Movements: class {
    blocksToAvoid = new Set();
    getBlock() {
      return null;
    }
  },
  goals: {
    GoalNear: class {
      constructor(
        public x: number,
        public y: number,
        public z: number,
        public range: number,
      ) {}
    },
    GoalFollow: class {
      constructor(
        public entity: { position: Vec3 },
        public distance: number,
      ) {}
      isEnd(p: Vec3) {
        return p.distanceTo(this.entity.position.floored()) <= this.distance;
      }
    },
  },
}));
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function fixture(patch = {}) {
  const config = minecraftConfigSchema.parse({
    freePlay: false,
    buildRadius: 4,
    maxBlocks: 16,
    movement: true,
    modifyBlocks: false,
    trustedPlayer: "Player",
    buildCenter: { x: 3, y: 64, z: 0 },
    ...patch,
  });
  const world = new Map<string, string>();
  const inventory = [
    { name: "dirt", count: 10 },
    { name: "cobblestone", count: 10 },
  ];
  const key = (p: Vec3) => `${p.x},${p.y},${p.z}`;
  let equipped = "dirt";
  const events = new EventEmitter();
  const bot = {
    on: events.on.bind(events),
    removeListener: events.removeListener.bind(events),
    emit: events.emit.bind(events),
    username: "Eva",
    entity: { position: new Vec3(0, 64, 0) },
    health: 20,
    food: 20,
    game: { dimension: "overworld" },
    players: { Player: { entity: { position: new Vec3(3, 64, 0) } } },
    entities: {},
    registry: { blocksByName: { dirt: { id: 1 }, farmland: { id: 2 } } },
    inventory: { items: () => inventory },
    pathfinder: {
      bestHarvestTool: vi.fn(() => null),
      setMovements: vi.fn(),
      setGoal: vi.fn(),
      goto: vi.fn(async (g: any) => {
        bot.entity.position = new Vec3(g.x, g.y, g.z - g.range);
      }),
    },
    clearControlStates: vi.fn(),
    setControlState: vi.fn(),
    stopDigging: vi.fn(),
    chat: vi.fn(),
    blockAt: vi.fn((p: Vec3) => {
      const name = world.get(key(p)) ?? (p.y === 63 ? "stone" : "air");
      return {
        position: p,
        name,
        boundingBox: name === "air" ? "empty" : "block",
        canHarvest: () => true,
      };
    }),
    findBlocks: vi.fn(() => [new Vec3(3, 64, 0)]),
    canDigBlock: vi.fn(() => true),
    dig: vi.fn(async (block: any) => {
      world.set(key(block.position), "air");
      inventory[0].count++;
    }),
    equip: vi.fn(async (item: any) => {
      equipped = item.name;
    }),
    placeBlock: vi.fn(async (block: any, face: Vec3) => {
      world.set(key(block.position.plus(face)), equipped);
    }),
  };
  const engine = new MinecraftEngine(config, bot as unknown as Bot, vi.fn());
  engine.ready();
  cleanup.push(() => engine.stop());
  return { bot, engine, world, config, inventory };
}

describe("Minecraft boundaries and jobs", () => {
  it("stores structured gameplay results and releases item use before replacement", async () => {
    const h = fixture({ freePlay: true });
    const activateItem = vi.fn(),
      deactivateItem = vi.fn(),
      lookAt = vi.fn(async () => {});
    Object.assign(h.bot, {
      heldItem: { name: "bow" },
      activateItem,
      deactivateItem,
      lookAt,
    });
    const first = await h.engine.call("use_item", { milliseconds: 5000 });
    expect(first).toMatchObject({ status: "running" });
    await vi.waitFor(() => expect(activateItem).toHaveBeenCalledOnce());
    await h.engine.call("look_at", { position: { x: 1, y: 65, z: 0 } });
    await vi.waitFor(() => expect(h.engine.job?.status).toBe("succeeded"));
    expect(deactivateItem).toHaveBeenCalled();
    expect(deactivateItem.mock.invocationCallOrder.at(-1)).toBeLessThan(
      lookAt.mock.invocationCallOrder[0],
    );
    expect(h.engine.job?.kind).toBe("look");
    expect(await h.engine.call("job_status", {})).toMatchObject({
      result: { summary: "Look direction updated." },
    });
  });
  it("waits for an aborted upstream operation to settle before another gameplay action", async () => {
    const h = fixture({ freePlay: true });
    let settle!: () => void;
    const pending = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const lookAt = vi
      .fn()
      .mockImplementationOnce(() => pending)
      .mockResolvedValue(undefined);
    Object.assign(h.bot, { lookAt });
    await h.engine.call("look_at", { position: { x: 1, y: 65, z: 0 } });
    await vi.waitFor(() => expect(lookAt).toHaveBeenCalledOnce());
    await h.engine.call("stop_action", {});
    expect(h.engine.job?.status).toBe("cancelled");
    await h.engine.call("look_at", { position: { x: 2, y: 65, z: 0 } });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(lookAt).toHaveBeenCalledOnce();
    settle();
    await vi.waitFor(() => expect(h.engine.job?.status).toBe("succeeded"));
    expect(lookAt).toHaveBeenCalledTimes(2);
  });
  it("Free play permits terrain navigation only with explicit block permission", () => {
    const disabled = fixture({ freePlay: true, modifyBlocks: false });
    expect(disabled.bot.pathfinder.setMovements.mock.calls[0][0].canDig).toBe(
      false,
    );
    const enabled = fixture({ freePlay: true, modifyBlocks: true });
    const m = enabled.bot.pathfinder.setMovements.mock.calls[0][0];
    expect([m.canDig, m.allow1by1towers, m.canOpenDoors]).toEqual([
      true,
      true,
      false,
    ]);
    expect(m.exclusionAreasBreak[0]({ position: new Vec3(100, 64, 0) })).toBe(
      100,
    );
  });
  it("Free play can place registered materials without a build fence", async () => {
    const h = fixture({ freePlay: true, modifyBlocks: true, buildRadius: 0 });
    Object.assign(h.bot.registry.blocksByName, { bricks: { id: 45 } });
    h.inventory.push({ name: "bricks", count: 3 });
    await h.engine.call("build_blocks", {
      blocks: [{ x: 100, y: 64, z: 0, block: "bricks" }],
    });
    await vi.waitFor(() => expect(h.engine.job?.status).toBe("succeeded"));
    expect(h.world.get("100,64,0")).toBe("bricks");
    expect(h.bot.setControlState).toHaveBeenLastCalledWith("sneak", false);
  });
  it("Free play replaces a running job cleanly when given another action", async () => {
    const h = fixture({ freePlay: true });
    await h.engine.call("follow_player", {});
    await h.engine.call("move_to", { x: 10, y: 64, z: 0 });
    await vi.waitFor(() => expect(h.engine.job?.status).toBe("succeeded"));
    expect(h.engine.job?.kind).toBe("move");
  });
  it("exposes tracked player coordinates beyond the nearby-entity display radius", async () => {
    const h = fixture();
    h.bot.players.Player.entity.position = new Vec3(90, 64, 0);
    expect(h.engine.observe().playerLocations?.[0]).toMatchObject({
      source: "tracking",
      position: { x: 90 },
    });
  });
  it("follows fresh operator coordinates when no player entity is tracked", async () => {
    const h = fixture({ operatorLookup: true });
    h.bot.players.Player.entity = undefined as any;
    h.bot.chat.mockImplementation((command: string) => {
      queueMicrotask(() =>
        h.bot.emit(
          "message",
          {
            json: {
              translate: "commands.data.entity.query",
              with: [
                "Player",
                command.endsWith(" Pos")
                  ? "[512d, 64d, 200d]"
                  : '"minecraft:overworld"',
              ],
            },
          },
          "system",
        ),
      );
    });
    await h.engine.call("follow_player", {});
    await vi.waitFor(() =>
      expect(h.engine.job?.detail).toContain("server-reported"),
    );
    expect(h.bot.pathfinder.setGoal.mock.calls.at(-1)?.[0]).toMatchObject({
      x: 512,
      y: 64,
      z: 200,
    });
    expect(h.bot.chat.mock.calls).toHaveLength(2);
  });
  it("follows a lost entity toward explicitly last-seen coordinates", async () => {
    const h = fixture();
    h.bot.players.Player.entity.position = new Vec3(150, 64, 0);
    h.engine.observe();
    h.bot.players.Player.entity = undefined as any;
    await h.engine.call("follow_player", {});
    await vi.waitFor(() => expect(h.engine.job?.detail).toContain("last-seen"));
    expect(h.bot.pathfinder.setGoal.mock.calls.at(-1)?.[0]).toMatchObject({
      x: 150,
      y: 64,
      z: 0,
    });
  });
  it("defaults to free play without a leash/timer or second block/chat gate", () => {
    const c = minecraftConfigSchema.parse({});
    expect([c.movement, c.chat, c.modifyBlocks, c.freePlay]).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect([c.radius, c.jobSeconds]).toEqual([0, 0]);
    expect(c.version).toBe("26.1");
    expect(minecraftConfigSchema.safeParse({ version: "1.12" }).success).toBe(
      false,
    );
    expect(
      minecraftConfigSchema.safeParse({ auth: "offline", username: "bad name" })
        .success,
    ).toBe(false);
  });
  it("all bundled tool definitions pass the host's bounded schema validation", () => {
    for (const tool of minecraftTools)
      expect(
        compileMcpTool(JSON.parse(JSON.stringify(tool)), "builtin-minecraft")
          .policy,
      ).toBe("deny");
  });
  it("navigation cannot dig, place, open doors or tower and excludes out-of-area steps", () => {
    const h = fixture();
    const m = safeMovements(h.bot as unknown as Bot, new Vec3(0, 64, 0), 8);
    expect(m.canDig).toBe(false);
    expect(m.scafoldingBlocks).toEqual([]);
    expect(m.allow1by1towers).toBe(false);
    expect(m.canOpenDoors).toBe(false);
    expect(m.maxDropDown).toBe(4);
    expect(m.allowParkour).toBe(true);
    expect(m.allowSprinting).toBe(true);
    expect(m.infiniteLiquidDropdownDistance).toBe(false);
    expect(m.blocksToAvoid.has(2)).toBe(true);
    expect(
      m.exclusionAreasStep[0]({ position: new Vec3(20, 64, 0) } as any),
    ).toBe(100);
    expect(inRadius({ x: 1, y: 64, z: 0 }, { x: 0, y: 64, z: 0 }, 2)).toBe(
      true,
    );
  });
  it("rejects movement without permission but still allows observation", async () => {
    const h = fixture({ movement: false });
    await expect(
      h.engine.call("move_to", { x: 2, y: 64, z: 0 }),
    ).rejects.toThrow("permission");
    expect(await h.engine.call("observe", {})).toHaveProperty(
      "connected",
      true,
    );
    expect(h.bot.pathfinder.goto).not.toHaveBeenCalled();
  });
  it("returns a job ID immediately and verifies movement completion", async () => {
    const h = fixture();
    const response = await h.engine.call("move_to", { x: 3, y: 64, z: 0 });
    expect(response).toHaveProperty("jobId");
    await vi.waitFor(() => expect(h.engine.job?.status).toBe("succeeded"));
    expect(h.engine.job?.progress).toBe(1);
  });
  it("fails a claimed navigation success if the bot did not arrive", async () => {
    const h = fixture();
    h.bot.pathfinder.goto.mockImplementation(async () => {});
    await h.engine.call("move_to", { x: 10, y: 64, z: 0 });
    await vi.waitFor(() => expect(h.engine.job?.status).toBe("failed"));
  });
  it("rejects distant targets and stops on dimension/health changes", async () => {
    const h = fixture({ radius: 32 });
    await h.engine.call("move_to", { x: 100, y: 64, z: 0 });
    await vi.waitFor(() => expect(h.engine.job?.status).toBe("failed"));
    expect(h.bot.pathfinder.goto).not.toHaveBeenCalled();
    await h.engine.call("follow_player", {});
    h.bot.game.dimension = "the_nether";
    h.engine.tick();
    expect(h.engine.job?.status).toBe("cancelled");
    expect(h.bot.clearControlStates).toHaveBeenCalled();
  });
  it("keeps one action owner, follows only the configured player, and cancels immediately", async () => {
    const h = fixture();
    await h.engine.call("follow_player", {});
    await expect(
      h.engine.call("move_to", { x: 2, y: 64, z: 0 }),
    ).rejects.toThrow("Another game job");
    expect(h.engine.job?.status).toBe("running");
    expect(await h.engine.call("job_status", {})).toHaveProperty(
      "kind",
      "follow",
    );
    h.engine.stop();
    expect(h.engine.job?.status).toBe("cancelled");
    expect(h.bot.pathfinder.setGoal).toHaveBeenLastCalledWith(null);
  });
  it("expires long-running jobs", async () => {
    vi.useFakeTimers();
    const h = fixture({ jobSeconds: 5 });
    await h.engine.call("follow_player", {});
    await vi.advanceTimersByTimeAsync(5001);
    expect(h.engine.job?.status).toBe("cancelled");
    expect(h.engine.job?.detail).toContain("time limit");
  });
  it("keeps a dynamic follow goal instead of resetting it every second", async () => {
    const h = fixture();
    h.bot.players.Player.entity.position = new Vec3(80, 64, 0);
    await h.engine.call("follow_player", {});
    await realDelay(1100);
    expect(h.bot.pathfinder.setGoal).toHaveBeenCalledTimes(1);
    expect(h.engine.job?.status).toBe("running");
    expect(h.engine.job?.detail).toContain("80 blocks away");
    h.bot.entity.position = new Vec3(80, 64, 1);
    h.engine.tick();
    expect(h.engine.job?.status).toBe("running");
  });
  it("waits for entity tracking and acquires the player when they appear", async () => {
    const h = fixture({ trustedPlayer: "" });
    const target = h.bot.players.Player.entity;
    h.bot.players.Player.entity = undefined as any;
    await h.engine.call("follow_player", {});
    await vi.waitFor(() =>
      expect(h.engine.job?.detail).toContain("Waiting for Player"),
    );
    h.bot.players.Player.entity = target;
    await realDelay(1100);
    expect(h.bot.pathfinder.setGoal).toHaveBeenCalledTimes(1);
    expect(h.engine.job?.status).toBe("running");
  });
  it("reports a configured leash violation rather than losing the reason", async () => {
    const h = fixture({ radius: 8 });
    h.bot.players.Player.entity.position = new Vec3(20, 64, 0);
    await h.engine.call("follow_player", { player: "player" });
    await vi.waitFor(() => expect(h.engine.job?.status).toBe("failed"));
    expect(h.engine.job?.detail).toContain("8-block leash");
  });
  it("reports an untracked player after the grace period", async () => {
    const h = fixture();
    h.bot.players.Player.entity = undefined as any;
    await h.engine.call("follow_player", {});
    await vi.waitFor(() =>
      expect(h.engine.job?.detail).toContain("Waiting for Player"),
    );
    const later = Date.now() + 31000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    await realDelay(1100);
    expect(h.engine.job?.status).toBe("failed");
    expect(h.engine.job?.detail).toContain("Cannot track Player");
  });
  it("reports a stuck path instead of claiming indefinite progress", async () => {
    const h = fixture();
    h.bot.players.Player.entity.position = new Vec3(20, 64, 0);
    await h.engine.call("follow_player", {});
    h.bot.emit("path_update", { status: "noPath" });
    await vi.waitFor(() =>
      expect(h.engine.job?.detail).toContain("Following Player"),
    );
    const later = Date.now() + 21000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    await realDelay(1100);
    expect(h.engine.job?.status).toBe("failed");
    expect(h.engine.job?.detail).toContain("no movement for 20 seconds");
  });
  it("uses safe pathfinder diagnostics without reflecting unknown upstream errors", () => {
    expect(
      gameFailureDetail(Object.assign(new Error("secret"), { name: "NoPath" })),
    ).toContain("No walkable route");
    expect(gameFailureDetail(new Error("secret-token"))).not.toContain(
      "secret-token",
    );
  });
  it("honors an explicit public-chat block and forbids commands/newlines", async () => {
    const h = fixture({ chat: false });
    await expect(
      h.engine.call("say_in_game", { text: "hello" }),
    ).rejects.toThrow("permission");
    const enabled = fixture({ chat: true });
    for (const text of ["/op Eva", " /kill", "hello\n/kill"])
      await expect(
        enabled.engine.call("say_in_game", { text }),
      ).rejects.toThrow();
    await enabled.engine.call("say_in_game", { text: "Hello world" });
    expect(enabled.bot.chat).toHaveBeenCalledWith("Hello world");
  });
  it("requires an explicit block permission and refuses out-of-area or oversized builds", async () => {
    const h = fixture();
    await expect(
      h.engine.call("build_blocks", {
        blocks: [{ x: 3, y: 64, z: 0, block: "dirt" }],
      }),
    ).rejects.toThrow("permission");
    const enabled = fixture({ modifyBlocks: true, maxBlocks: 1 });
    await expect(
      enabled.engine.call("build_blocks", {
        blocks: [{ x: 30, y: 64, z: 0, block: "dirt" }],
      }),
    ).rejects.toThrow("area");
    await expect(
      enabled.engine.call("build_blocks", {
        blocks: [{ x: 3, y: 64, z: 0, block: "tnt" }],
      }),
    ).rejects.toThrow();
    expect(enabled.bot.placeBlock).not.toHaveBeenCalled();
  });
  it("builds a small simulated structure and verifies actual blocks", async () => {
    const h = fixture({ modifyBlocks: true });
    await h.engine.call("build_blocks", {
      blocks: [
        { x: 3, y: 64, z: 0, block: "dirt" },
        { x: 4, y: 64, z: 0, block: "dirt" },
      ],
    });
    await vi.waitFor(() => expect(h.engine.job?.status).toBe("succeeded"));
    expect(h.engine.job?.progress).toBe(2);
    expect(h.world.get("3,64,0")).toBe("dirt");
    expect(h.world.get("4,64,0")).toBe("dirt");
  });
  it("will not overwrite an occupied block", async () => {
    const h = fixture({ modifyBlocks: true });
    h.world.set("3,64,0", "chest");
    await h.engine.call("build_blocks", {
      blocks: [{ x: 3, y: 64, z: 0, block: "dirt" }],
    });
    await vi.waitFor(() => expect(h.engine.job?.status).toBe("failed"));
    expect(h.bot.placeBlock).not.toHaveBeenCalled();
  });
  it("does not claim a build succeeded if placement is never observed", async () => {
    vi.useFakeTimers();
    const h = fixture({ modifyBlocks: true });
    h.bot.placeBlock.mockImplementation(async () => {});
    await h.engine.call("build_blocks", {
      blocks: [{ x: 3, y: 64, z: 0, block: "dirt" }],
    });
    await vi.advanceTimersByTimeAsync(8200);
    await realDelay(150);
    expect(h.engine.job?.status).toBe("failed");
  });
  it("collects only inside the build area and verifies inventory increase", async () => {
    const h = fixture({ modifyBlocks: true });
    h.world.set("3,64,0", "dirt");
    await h.engine.call("collect_blocks", { block: "dirt", count: 1 });
    await vi.waitFor(() => expect(h.engine.job?.status).toBe("succeeded"));
    expect(h.inventory[0].count).toBe(11);
    expect(h.world.get("3,64,0")).toBe("air");
  });
  it("does not claim collection when no item is picked up", async () => {
    vi.useFakeTimers();
    const h = fixture({ modifyBlocks: true });
    h.world.set("3,64,0", "dirt");
    h.bot.dig.mockImplementation(async (block: any) => {
      h.world.set(
        `${block.position.x},${block.position.y},${block.position.z}`,
        "air",
      );
    });
    await h.engine.call("collect_blocks", { block: "dirt", count: 1 });
    await vi.advanceTimersByTimeAsync(8200);
    await realDelay(150);
    expect(h.engine.job?.status).toBe("failed");
  });
});

describe("Minecraft persistence and character scoping", () => {
  it("interrupts crash-left jobs and never replays them", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "eva-mc-test-"));
    cleanup.push(() => rmSync(dir, { recursive: true }));
    const store = new Store(dir);
    store.update((d) =>
      d.minecraft.jobs.push({
        id: "old",
        kind: "build",
        status: "running",
        progress: 1,
        total: 3,
        detail: "old",
        startedAt: "now",
        updatedAt: "now",
        worldId: "world",
        characterId: "eva",
      }),
    );
    const plugin = new MinecraftPlugin(store, () => {});
    expect(plugin.snapshot().jobs[0].status).toBe("interrupted");
    expect(plugin.snapshot().live.connected).toBe(false);
  });
  it("stores world-scoped landmarks, ignores late disconnected events and cancels on transport stop", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "eva-mc-test-"));
    cleanup.push(() => rmSync(dir, { recursive: true }));
    const store = new Store(dir);
    let publish!: (s: MinecraftLive) => void;
    const stopAction = vi.fn();
    const factory: MinecraftFactory = (_cfg, fn) => {
      publish = fn;
      return {
        connect: async () => {},
        list: async () => [],
        call: async () => ({}),
        close: async () => {},
        stopAction,
      };
    };
    const plugin = new MinecraftPlugin(store, () => {}, factory);
    const connection = plugin.create(() => {});
    const state: MinecraftLive = {
      status: "Connected",
      connected: true,
      position: { x: 1, y: 64, z: 2 },
      dimension: "overworld",
      players: [],
      inventory: [],
      nearby: [],
    };
    publish(state);
    plugin.saveLandmark("Our base");
    expect(plugin.context()).toContain("Our base");
    store.update((d) => {
      d.minecraft.config.worldId = "different-world";
    });
    expect(plugin.context()).not.toContain("Our base");
    plugin.stopAction();
    expect(stopAction).toHaveBeenCalledOnce();
    await connection.close();
    publish(state);
    expect(plugin.snapshot().live.connected).toBe(false);
    expect(() => plugin.saveLandmark("stale")).toThrow();
  });
});
