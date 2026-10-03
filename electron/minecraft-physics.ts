import type { Bot } from "mineflayer";

/** 26.1 uses lpVec3 (blocks/tick), but Mineflayer 4.39 still divides by 8000.
 * Apply decoded velocities AFTER the built-in entities listener. Assignment,
 * not multiplication, also remains correct once upstream fixes its conversion.
 * Keep legacy protocol velocities untouched. No packets/commands are sent.
 */
export function minecraftPhysicsCompatibility(bot: Bot) {
  if (bot.version !== "26.1") return;
  const velocity = (packet: {
    entityId: number;
    velocity?: { x: number; y: number; z: number };
  }) => {
    const v = packet.velocity;
    if (!v || ![v.x, v.y, v.z].every(Number.isFinite)) return;
    const entity = bot.entities[packet.entityId];
    entity?.velocity.set(v.x, v.y, v.z);
  };
  bot._client.on("entity_velocity", velocity);
  bot._client.on("spawn_entity", velocity);
}

/** Wall-clock check, not physicsTick-driven: a stopped physics loop cannot
 * diagnose itself. Idle but healthy bots still emit physicsTick at 20 Hz.
 */
export class MinecraftPhysicsHealth {
  private lastTick: number;
  private readonly onTick = () => {
    this.lastTick = this.now();
  };
  constructor(
    private bot: Bot,
    private now = Date.now,
  ) {
    this.lastTick = now();
    bot.on("physicsTick", this.onTick);
  }
  problem(): string | undefined {
    const entity = this.bot.entity;
    if (
      entity &&
      ![
        entity.position.x,
        entity.position.y,
        entity.position.z,
        entity.velocity.x,
        entity.velocity.y,
        entity.velocity.z,
      ].every(Number.isFinite)
    )
      return "Minecraft physics produced invalid coordinates or velocity. Reconnect Eva.";
    if (this.now() - this.lastTick > 8000)
      return "Minecraft physics stopped updating for 8 seconds (world/chunks may be paused or unavailable). Reconnect Eva.";
  }
  dispose() {
    this.bot.removeListener("physicsTick", this.onTick);
  }
}
