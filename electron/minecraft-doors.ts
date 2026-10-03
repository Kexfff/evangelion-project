import type { Bot } from "mineflayer";
import type { Movements } from "mineflayer-pathfinder";
import { Vec3 } from "vec3";

type Block = NonNullable<ReturnType<Bot["blockAt"]>>;
export function doorState(block: Block) {
  const properties = block.getProperties();
  const door =
    block.name.endsWith("_door") && !block.name.endsWith("_trapdoor");
  const gate = block.name.endsWith("_fence_gate");
  return {
    door,
    gate,
    manual: (door && block.name !== "iron_door") || gate,
    open: properties.open === true,
    upper: properties.half === "upper",
  };
}

/** Door cells are traversable through their center once open, including both
 * halves. Keep this projection local to planning; never mutate world blocks.
 * Interaction is owned by DoorNavigation, not pathfinder's buggy useOne queue.
 */
export function doorMovements(
  movement: Movements,
  allowed: boolean,
  inArea: (p: Vec3) => boolean = () => true,
) {
  const m = movement as Movements & {
    getBlock(
      p: Vec3,
      x: number,
      y: number,
      z: number,
    ): Block & Record<string, unknown>;
  };
  const get = m.getBlock.bind(m);
  m.getBlock = (p, x, y, z) => {
    const b = get(p, x, y, z);
    if (!b?.getProperties) return b;
    const s = doorState(b);
    if (
      (s.door || s.gate) &&
      (s.open || (allowed && s.manual && inArea(b.position)))
    )
      return Object.assign(Object.create(Object.getPrototypeOf(b)), b, {
        safe: true,
        physical: false,
        openable: false,
        replaceable: false,
        height: b.position.y,
        shapes: [],
      });
    return b;
  };
  movement.canOpenDoors = false;
  movement.digCost = 12;
  movement.placeCost = 8;
}

export class DoorNavigation {
  private route: Vec3[] = [];
  private pending = false;
  private epoch = 0;
  private readonly path = (result: {
    path: { x: number; y: number; z: number }[];
  }) => {
    this.route = (result.path ?? [])
      .slice(0, 256)
      .map((p) => new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)));
  };
  constructor(
    private bot: Bot,
    private allowed: (p?: Vec3) => boolean,
    private fail: (reason: string) => void,
  ) {
    bot.on("path_update", this.path);
  }
  stop() {
    this.epoch++;
    this.route = [];
  }
  dispose() {
    this.stop();
    this.bot.removeListener("path_update", this.path);
  }
  async idle(signal: AbortSignal) {
    const until = Date.now() + 5000;
    while (this.pending) {
      signal.throwIfAborted();
      if (Date.now() > until)
        throw new Error("Previous door interaction has not settled.");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  tick() {
    if (this.pending || !this.allowed()) return;
    for (const p of this.route) {
      if (this.bot.entity.position.distanceTo(p) > 3) continue;
      let b = this.bot.blockAt(p);
      if (!b) continue;
      const s = doorState(b);
      if (!s.manual || s.open) continue;
      if (s.upper) b = this.bot.blockAt(p.offset(0, -1, 0));
      if (!b || !this.allowed(b.position) || !this.bot.canSeeBlock(b)) continue;
      this.pending = true;
      const epoch = this.epoch,
        target = b,
        end = Date.now() + 4000;
      const timeout = setTimeout(() => {
        if (epoch === this.epoch)
          this.fail(
            "Door interaction timed out; inspect the entrance before continuing.",
          );
      }, 4500);
      void (async () => {
        // A single click, followed by observed state; no toggle retries.
        await this.bot.activateBlock(target);
        while (epoch === this.epoch) {
          const current = this.bot.blockAt(target.position);
          if (current && doorState(current).open) return;
          if (Date.now() >= end) throw new Error("Door did not open");
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      })()
        .catch(() => {
          if (epoch === this.epoch)
            this.fail(
              "The entrance did not open. Check the door or its redstone mechanism.",
            );
        })
        .finally(() => {
          clearTimeout(timeout);
          this.pending = false;
        });
      break;
    }
  }
}
