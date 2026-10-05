import { Vec3 } from "vec3";

/** A heartbeat, sub-block jitter or revisiting the same small loop is not
 * travel progress. Bound memory for very long paths; the goal deadline remains.
 */
export class NavigationProgress {
  private visited = new Set<string>();
  private last: Vec3;
  constructor(start: Vec3) {
    this.last = start.clone();
    this.visited.add(start.floored().toString());
  }
  observe(position: Vec3) {
    const key = position.floored().toString();
    if (this.visited.has(key) || position.distanceTo(this.last) < 1)
      return false;
    this.visited.add(key);
    if (this.visited.size > 8192)
      this.visited.delete(this.visited.values().next().value!);
    this.last = position.clone();
    return true;
  }
}
