import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { Vec3 } from "vec3";
import { Movements, goals } from "mineflayer-pathfinder";
import {
  doorMovements,
  DoorNavigation,
  doorState,
} from "../electron/minecraft-doors";
const require = createRequire(import.meta.url);
const registry = require("prismarine-registry")("26.1");
const Block = require("prismarine-block")(registry);
const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((f) => f());
  vi.useRealTimers();
});
function fixture(
  name = "oak_door",
  facing = "north",
  hinge = "left",
  open = false,
  allowed = true,
) {
  const world = new Map<string, any>();
  const block = (name: string, p: Vec3, props = {}) => {
    const b = Block.fromProperties(name, props, 0);
    b.position = p;
    world.set(p.toString(), b);
    return b;
  };
  const lower = () =>
    block(name, new Vec3(1, 64, 0), {
      facing,
      hinge,
      open,
      half: "lower",
      powered: false,
      in_wall: false,
    });
  lower();
  if (name.endsWith("_door"))
    block(name, new Vec3(1, 65, 0), {
      facing,
      hinge,
      open,
      half: "upper",
      powered: false,
    });
  const bot: any = Object.assign(new EventEmitter(), {
    registry,
    game: { minY: -64 },
    entity: { position: new Vec3(0, 64, 0), effects: {} },
    inventory: { items: () => [] },
    blockAt: (p: Vec3) =>
      world.get(p.floored().toString()) ??
      block(p.y < 64 ? "stone" : "air", p.floored()),
    pathfinder: { bestHarvestTool: () => null },
    canSeeBlock: () => true,
    activateBlock: vi.fn(async () => {
      open = true;
      lower();
    }),
  });
  const movements: any = new Movements(bot);
  doorMovements(movements, allowed);
  const fail = vi.fn(),
    doors = new DoorNavigation(bot, () => allowed, fail);
  cleanup.push(() => doors.dispose());
  return { bot, movements, world, doors, fail };
}
describe("door-aware navigation against installed 26.1 block data/pathfinder", () => {
  it("opens either leaf of a double entrance without touching the other leaf", async () => {
    const f = fixture();
    for (const half of ["lower", "upper"]) {
      const b = Block.fromProperties(
        "oak_door",
        { facing: "north", hinge: "right", half, open: false, powered: false },
        0,
      );
      b.position = new Vec3(1, half === "lower" ? 64 : 65, 1);
      f.world.set(b.position.toString(), b);
    }
    f.bot.activateBlock.mockImplementation(async (target: any) => {
      for (const y of [64, 65]) {
        const old = f.bot.blockAt(
          new Vec3(target.position.x, y, target.position.z),
        );
        const b = Block.fromProperties(
          old.name,
          { ...old.getProperties(), open: true },
          0,
        );
        b.position = old.position;
        f.world.set(b.position.toString(), b);
      }
    });
    f.bot.emit("path_update", { path: [{ x: 1, y: 64, z: 1 }] });
    f.doors.tick();
    await f.doors.idle(new AbortController().signal);
    expect(doorState(f.bot.blockAt(new Vec3(1, 64, 1))).open).toBe(true);
    expect(doorState(f.bot.blockAt(new Vec3(1, 64, 0))).open).toBe(false);
    expect(f.bot.activateBlock).toHaveBeenCalledOnce();
  });
  it("honors optional interaction area while still allowing already-open entrances", () => {
    const closed = fixture(),
      open = fixture("oak_door", "north", "left", true);
    for (const f of [closed, open]) {
      const movement: any = new Movements(f.bot);
      doorMovements(movement, true, () => false);
      expect(movement.getBlock(new Vec3(0, 64, 0), 1, 0, 0).safe).toBe(
        f === open,
      );
    }
  });
  it("fences a pending click after Stop and does not touch the next door", async () => {
    const f = fixture();
    let settle!: () => void;
    f.bot.activateBlock.mockImplementation(
      () =>
        new Promise<void>((r) => {
          settle = r;
        }),
    );
    f.bot.emit("path_update", { path: [{ x: 1, y: 64, z: 0 }] });
    f.doors.tick();
    f.doors.stop();
    f.doors.tick();
    settle();
    await f.doors.idle(new AbortController().signal);
    expect(f.bot.activateBlock).toHaveBeenCalledOnce();
    expect(f.fail).not.toHaveBeenCalled();
  });
  it("prefers a doorway detour over breaking the house wall in actual A* search", () => {
    const f = fixture();
    // A wall at x=1, with the existing doorway at z=0. Start opposite a solid wall cell.
    for (let z = -4; z <= 4; z++)
      for (let y = 64; y <= 67; y++) {
        if (z === 0 && y <= 65) continue;
        const b = Block.fromProperties("oak_planks", {}, 0);
        b.position = new Vec3(1, y, z);
        f.world.set(b.position.toString(), b);
      }
    const AStar = require("mineflayer-pathfinder/lib/astar"),
      Move = require("mineflayer-pathfinder/lib/move");
    for (const [startX, endX] of [
      [0, 2],
      [2, 0],
    ]) {
      const search = new AStar(
        new Move(startX, 64, 2, 0, 0),
        f.movements,
        new goals.GoalBlock(endX, 64, 2),
        1000,
        1000,
        20,
      );
      const result = search.compute();
      expect(result.status).toBe("success");
      expect(result.path.some((p: any) => p.x === 1 && p.z === 0)).toBe(true);
      expect(
        result.path.every(
          (p: any) => p.toBreak.length === 0 && p.toPlace.length === 0,
        ),
      ).toBe(true);
    }
  });
  it("bounds a failed opening and never toggles repeatedly", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.bot.activateBlock.mockImplementation(async () => {});
    f.bot.emit("path_update", { path: [{ x: 1, y: 64, z: 0 }] });
    f.doors.tick();
    await vi.advanceTimersByTimeAsync(4600);
    expect(f.fail).toHaveBeenCalled();
    expect(f.bot.activateBlock).toHaveBeenCalledOnce();
    f.doors.stop();
  });
  it.each(
    ["north", "south", "east", "west"].flatMap((f) =>
      ["left", "right"].map((h) => [f, h]),
    ),
  )(
    "plans through both door halves (%s/%s) without breaking or scaffolding",
    (facing, hinge) => {
      const f = fixture("oak_door", facing, hinge);
      const neighbors: any[] = [];
      f.movements.getMoveForward(
        { x: 0, y: 64, z: 0, remainingBlocks: 0 },
        { x: 1, z: 0 },
        neighbors,
      );
      expect(neighbors).toHaveLength(1);
      expect(neighbors[0].toBreak).toEqual([]);
      expect(neighbors[0].toPlace).toEqual([]);
      expect(f.movements.getBlock(new Vec3(1, 64, 0), 0, 1, 0).safe).toBe(true);
      expect(doorState(f.bot.blockAt(new Vec3(1, 64, 0))).open).toBe(false); // planning never changes the world
    },
  );
  it("opens a nearby planned door once, verifies it, and does not toggle it shut", async () => {
    const f = fixture();
    f.bot.emit("path_update", { path: [{ x: 1, y: 64, z: 0 }] });
    f.doors.tick();
    f.doors.tick();
    await f.doors.idle(new AbortController().signal);
    f.doors.tick();
    expect(f.bot.activateBlock).toHaveBeenCalledOnce();
    expect(f.fail).not.toHaveBeenCalled();
  });
  it("normalizes the upper half to its lower interaction target", async () => {
    const f = fixture();
    f.bot.emit("path_update", { path: [{ x: 1, y: 65, z: 0 }] });
    f.doors.tick();
    await f.doors.idle(new AbortController().signal);
    expect(f.bot.activateBlock.mock.calls[0][0].position.y).toBe(64);
  });
  it("does not interact when blocked or when a door is already open", async () => {
    for (const f of [
      fixture("oak_door", "north", "left", true),
      fixture("oak_door", "north", "left", false, false),
    ]) {
      f.bot.emit("path_update", { path: [{ x: 1, y: 64, z: 0 }] });
      f.doors.tick();
      expect(f.bot.activateBlock).not.toHaveBeenCalled();
    }
  });
  it("does not pretend iron doors can be right-clicked open", () => {
    const f = fixture("iron_door");
    f.bot.emit("path_update", { path: [{ x: 1, y: 64, z: 0 }] });
    f.doors.tick();
    expect(f.bot.activateBlock).not.toHaveBeenCalled();
    expect(f.movements.getBlock(new Vec3(0, 64, 0), 1, 0, 0).safe).toBe(false);
  });
  it("uses gates without entering the upstream placement/scaffolding queue", () => {
    const f = fixture("oak_fence_gate");
    const neighbors: any[] = [];
    f.movements.getMoveForward(
      { x: 0, y: 64, z: 0, remainingBlocks: 0 },
      { x: 1, z: 0 },
      neighbors,
    );
    expect(neighbors).toHaveLength(1);
    expect(neighbors[0].toPlace).toEqual([]);
    expect(f.movements.canOpenDoors).toBe(false);
  });
  it("clears door intent on stop and removes its path listener on dispose", () => {
    const f = fixture();
    f.bot.emit("path_update", { path: [{ x: 1, y: 64, z: 0 }] });
    f.doors.stop();
    f.doors.tick();
    expect(f.bot.activateBlock).not.toHaveBeenCalled();
    f.doors.dispose();
    expect(f.bot.listenerCount("path_update")).toBe(0);
  });
  it("does not touch distant or out-of-sight doors", () => {
    const f = fixture();
    f.bot.canSeeBlock = () => false;
    f.bot.emit("path_update", { path: [{ x: 1, y: 64, z: 0 }] });
    f.doors.tick();
    expect(f.bot.activateBlock).not.toHaveBeenCalled();
    f.bot.canSeeBlock = () => true;
    f.bot.entity.position = new Vec3(20, 64, 0);
    f.doors.tick();
    expect(f.bot.activateBlock).not.toHaveBeenCalled();
  });
});
