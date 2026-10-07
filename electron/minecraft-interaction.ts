import type { Bot } from "mineflayer";
import { goals } from "mineflayer-pathfinder";
import { Vec3 } from "vec3";

type Block = NonNullable<ReturnType<Bot["blockAt"]>>;
// Installed prismarine-world passes the iterator to matchers and returns a
// Block; its bundled declarations still describe an older RaycastResult API.
type RayWorld = {
  raycast(
    from: Vec3,
    direction: Vec3,
    range: number,
    match: (
      block: Block,
      ray: { intersect(shapes: Block["shapes"], position: Vec3): unknown },
    ) => boolean,
  ): Block | null;
};

/** Use the same eye-to-target ray for A* endpoints and the final live check.
 * Proximity alone accepts the wrong side of a wall. No blocks are modified here.
 */
export function canInteractFrom(
  bot: Bot,
  feet: Vec3,
  target: Vec3,
  reach = 4.5,
) {
  const eye = feet.offset(
    0,
    (bot.entity as Bot["entity"] & { eyeHeight?: number }).eyeHeight ?? 1.62,
    0,
  );
  const direction = target.offset(0.5, 0.5, 0.5).minus(eye);
  if (direction.norm() > reach) return false;
  const hit = (bot.world as unknown as RayWorld).raycast(
    eye,
    direction.normalize(),
    reach,
    (block, ray) =>
      !!ray.intersect(block.shapes, block.position) ||
      block.position.equals(target),
  );
  return !!hit && hit.position.equals(target);
}

export class GoalInteractBlock extends goals.GoalNear {
  constructor(
    private bot: Bot,
    private target: Vec3,
  ) {
    // Keep pathfinder's proximity guidance, but require visibility to finish.
    super(target.x, target.y, target.z, 4);
  }
  isEnd(node: { x: number; y: number; z: number }) {
    return canInteractFrom(
      this.bot,
      new Vec3(node.x + 0.5, node.y, node.z + 0.5),
      this.target,
      // goto accepts a waypoint within 0.35 on each horizontal axis. Leave
      // half a block of slack so a valid cell center isn't an out-of-reach
      // actual arrival. The final live check retains Minecraft's full reach.
      4,
    );
  }
}
