import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { Vec3 } from "vec3";
import { Movements, goals } from "mineflayer-pathfinder";
import {
  canInteractFrom,
  GoalInteractBlock,
} from "../electron/minecraft-interaction";
import { doorMovements } from "../electron/minecraft-doors";
import { MinecraftEngine } from "../electron/minecraft-engine";
import { minecraftConfigSchema } from "../src/shared/minecraft";

const require = createRequire(import.meta.url);
const registry = require("prismarine-registry")("26.1");
const Block = require("prismarine-block")(registry);
const WorldSync = require("prismarine-world/src/worldsync");
const AStar = require("mineflayer-pathfinder/lib/astar");
const Move = require("mineflayer-pathfinder/lib/move");

function fixture(door = false) {
  const blocks = new Map<string, any>();
  const place = (name: string, x: number, y: number, z: number, props = {}) => {
    const block = Block.fromProperties(name, props, 0);
    block.position = new Vec3(x, y, z);
    blocks.set(block.position.toString(), block);
    return block;
  };
  const bot: any = Object.assign(new EventEmitter(), {
    registry,
    game: { minY: -64 },
    entity: { position: new Vec3(0.5, 64, 0.5), eyeHeight: 1.62, effects: {} },
    inventory: { items: () => [] },
    pathfinder: { bestHarvestTool: () => null },
    blockAt: (p: Vec3) =>
      blocks.get(p.floored().toString()) ??
      place(
        p.y < 64 ? "stone" : "air",
        Math.floor(p.x),
        Math.floor(p.y),
        Math.floor(p.z),
      ),
  });
  bot.world = {
    raycast: (...args: any[]) =>
      WorldSync.prototype.raycast.call({ getBlock: bot.blockAt }, ...args),
  };
  for (let z = -3; z <= 3; z++)
    for (let y = 64; y <= 67; y++) {
      if (door && z === -2 && y <= 65)
        place("oak_door", 1, y, z, {
          half: y === 64 ? "lower" : "upper",
          facing: "east",
          hinge: "left",
          open: true,
          powered: false,
        });
      else place("oak_planks", 1, y, z);
    }
  const target = place("crafting_table", 2, 64, 0).position;
  const movements = new Movements(bot);
  doorMovements(movements, true);
  return { bot, target, movements, place };
}

describe("block interaction navigation with real 26.1 collision/raycast and A*", () => {
  it("publishes navigation progress only for actual travel and stops tracking on cancellation", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const f = fixture();
    let release!: () => void;
    Object.assign(f.bot, { clearControlStates: vi.fn(), stopDigging: vi.fn() });
    Object.assign(f.bot.pathfinder, {
      setMovements: vi.fn(),
      setGoal: vi.fn(),
      goto: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      ),
    });
    const engine = new MinecraftEngine(
      minecraftConfigSchema.parse({}),
      f.bot,
      () => {},
    );
    try {
      engine.ready();
      await engine.call("move_to", { x: 10, y: 64, z: 0 });
      await vi.waitFor(() => expect(release).toBeTypeOf("function"));
      const started = engine.job!.lastProgressAt;
      vi.setSystemTime(Date.now() + 60000);
      engine.tick();
      expect(engine.job!.lastProgressAt).toBe(started);
      f.bot.entity.position = new Vec3(1.5, 64, 0.5);
      engine.tick();
      const moved = engine.job!.lastProgressAt;
      expect(moved).not.toBe(started);
      expect(engine.job!.progressDetail).toContain("Travelled");
      vi.setSystemTime(Date.now() + 60000);
      for (const x of [0.5, 1.5, 0.5, 1.5]) {
        f.bot.entity.position = new Vec3(x, 64, 0.5);
        engine.tick();
      }
      expect(engine.job!.lastProgressAt).toBe(moved);
      engine.stop();
      f.bot.entity.position = new Vec3(5.5, 64, 0.5);
      engine.tick();
      expect(engine.job!.lastProgressAt).toBe(moved);
    } finally {
      release?.();
      engine.dispose();
      vi.useRealTimers();
    }
  });
  it.each([true, false])(
    "engine crafts only after an actually completed visible approach (arrived=%s)",
    async (arrived) => {
      const f = fixture(),
        items: { name: string; count: number }[] = [];
      Object.assign(f.bot, {
        clearControlStates: vi.fn(),
        stopDigging: vi.fn(),
        recipesFor: (
          _id: number,
          _meta: unknown,
          _count: number,
          table: unknown,
        ) => (table ? [{ requiresTable: true, result: { count: 1 } }] : []),
        findBlocks: () => [f.target],
        craft: vi.fn(async () => {
          items.push({ name: "wooden_pickaxe", count: 1 });
        }),
      });
      f.bot.inventory.items = () => items;
      Object.assign(f.bot.pathfinder, {
        setMovements: vi.fn(),
        setGoal: vi.fn(),
        goto: vi.fn(async (goal) => {
          expect(goal).toBeInstanceOf(GoalInteractBlock);
          if (!arrived) return; // Upstream goto can resolve an empty unsuccessful path.
          const result = new AStar(
            new Move(0, 64, 0, 0, 0),
            f.movements,
            goal,
            2000,
            2000,
            30,
          ).compute();
          expect(result.status).toBe("success");
          const end = result.path.at(-1);
          f.bot.entity.position = new Vec3(end.x + 0.5, end.y, end.z + 0.5);
        }),
      });
      const engine = new MinecraftEngine(
        minecraftConfigSchema.parse({}),
        f.bot,
        () => {},
      );
      try {
        engine.ready();
        await engine.call("craft_item", { item: "wooden_pickaxe", count: 1 });
        await vi.waitFor(() =>
          expect(engine.job?.status).toBe(arrived ? "succeeded" : "failed"),
        );
        expect(f.bot.craft).toHaveBeenCalledTimes(arrived ? 1 : 0);
        if (arrived)
          expect(engine.job?.progressDetail).toContain(
            "Crafted 1/1 operations",
          );
        if (!arrived)
          expect(engine.job?.detail).toContain("No usable table approach");
        expect(engine.job?.diagnostics?.[0].outcome).toBe(
          arrived ? "reached" : "interaction_blocked",
        );
      } finally {
        engine.dispose();
      }
    },
  );
  it.each([false, true])(
    "walks around a wall / through an existing open entrance (door=%s), not through the bench",
    (door) => {
      const f = fixture(door),
        start = new Move(0, 64, 0, 0, 0);
      expect(new goals.GoalNear(2, 64, 0, 2).isEnd(start)).toBe(true); // old bug
      const goal = new GoalInteractBlock(f.bot, f.target);
      expect(goal.isEnd(start)).toBe(false);
      expect(canInteractFrom(f.bot, f.bot.entity.position, f.target)).toBe(
        false,
      );
      const result = new AStar(
        start,
        f.movements,
        goal,
        2000,
        2000,
        30,
      ).compute();
      expect(result.status).toBe("success");
      expect(result.path.length).toBeGreaterThan(1);
      expect(
        result.path.every((p: any) => !p.toBreak.length && !p.toPlace.length),
      ).toBe(true);
      const end = result.path.at(-1);
      expect(goal.isEnd(end)).toBe(true);
      expect(
        canInteractFrom(
          f.bot,
          new Vec3(end.x + 0.5, end.y, end.z + 0.5),
          f.target,
        ),
      ).toBe(true);
    },
  );
  it("rejects distant or newly obstructed interaction positions", () => {
    const f = fixture();
    const feet = new Vec3(3.5, 64, 0.5);
    expect(canInteractFrom(f.bot, feet, f.target)).toBe(true);
    expect(canInteractFrom(f.bot, new Vec3(20, 64, 0), f.target)).toBe(false);
    f.place("stone", 3, 65, 0);
    expect(canInteractFrom(f.bot, feet, f.target)).toBe(false);
  });
  it("keeps reach slack for pathfinder's approximate waypoint arrival", () => {
    const f = fixture();
    const target = f.place("crafting_table", 8, 64, 0).position;
    const center = new Vec3(4.5, 64, 0.5);
    expect(canInteractFrom(f.bot, center, target)).toBe(true);
    expect(
      new GoalInteractBlock(f.bot, target).isEnd({ x: 4, y: 64, z: 0 }),
    ).toBe(false);
    expect(
      new GoalInteractBlock(f.bot, target).isEnd({ x: 5, y: 64, z: 0 }),
    ).toBe(true);
  });
});
