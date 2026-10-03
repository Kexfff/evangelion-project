import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { Vec3 } from "vec3";
import type { Bot } from "mineflayer";
import {
  minecraftPhysicsCompatibility,
  MinecraftPhysicsHealth,
} from "../electron/minecraft-physics";

const require = createRequire(import.meta.url);
// Exercise the installed upstream entities handler, not a mock conversion.
function fixture(version = "26.1") {
  const registry = require("prismarine-registry")(version);
  const bot = Object.assign(new EventEmitter(), {
    version,
    registry,
    supportFeature: registry.supportFeature,
    _client: new EventEmitter(),
  }) as unknown as Bot;
  require("mineflayer/lib/plugins/entities")(bot);
  bot.entity = bot.entities[1] = {
    position: new Vec3(0, 64, 0),
    velocity: new Vec3(0, 0, 0),
  } as Bot["entity"];
  return bot;
}

describe("Minecraft 26.1 physics compatibility", () => {
  it("preserves decoded lpVec3 knockback through the real upstream entity handler", () => {
    const bot = fixture();
    const [
      read,
      write,
      size,
    ] = require("minecraft-protocol/src/datatypes/lpVec3");
    const velocity = { x: 0.4, y: 0.4, z: -0.25 };
    const bytes = Buffer.alloc(size(velocity));
    write(velocity, bytes, 0);
    const packet = { entityId: 1, velocity: read(bytes, 0).value };
    minecraftPhysicsCompatibility(bot);
    bot._client.emit("entity_velocity", packet);
    expect(bot.entity.velocity.x).toBeCloseTo(0.4, 3);
    expect(bot.entity.velocity.y).toBeCloseTo(0.4, 3);
    expect(bot.entity.velocity.z).toBeCloseTo(-0.25, 3);
    bot._client.emit("entity_velocity", packet);
    expect(bot.entity.velocity.x).toBeCloseTo(0.4, 3); // not accumulated
  });
  it("keeps old fixed-point velocity conversion untouched", () => {
    const bot = fixture("1.21.4");
    minecraftPhysicsCompatibility(bot);
    bot._client.emit("entity_velocity", {
      entityId: 1,
      velocity: { x: 3200, y: 3200, z: -2000 },
    });
    expect(bot.entity.velocity).toEqual(new Vec3(0.4, 0.4, -0.25));
  });
  it("also corrects entity spawn velocity", () => {
    const bot = fixture();
    minecraftPhysicsCompatibility(bot);
    bot._client.emit("spawn_entity", {
      entityId: 2,
      type: bot.registry.entitiesByName.item.id,
      objectUUID: "00000000-0000-0000-0000-000000000001",
      x: 0,
      y: 64,
      z: 0,
      yaw: 0,
      pitch: 0,
      velocity: { x: 0.2, y: 0.3, z: 0 },
    });
    expect(bot.entities[2].velocity).toEqual(new Vec3(0.2, 0.3, 0));
  });
  it("detects stopped physics using wall time even when no physics event arrives", () => {
    const bot = fixture();
    let now = 0;
    const health = new MinecraftPhysicsHealth(bot, () => now);
    expect(health.problem()).toBeUndefined();
    now = 7000;
    bot.emit("physicsTick");
    now = 14000;
    expect(health.problem()).toBeUndefined(); // stationary isn't stalled
    now = 16000;
    expect(health.problem()).toContain("stopped updating");
    health.dispose();
    expect(bot.listenerCount("physicsTick")).toBe(0);
  });
  it("detects invalid velocity and all three position axes immediately", () => {
    for (const field of ["position", "velocity"] as const)
      for (const axis of ["x", "y", "z"] as const) {
        const bot = fixture();
        const health = new MinecraftPhysicsHealth(bot);
        bot.entity[field][axis] = NaN;
        expect(health.problem()).toContain("invalid coordinates or velocity");
        health.dispose();
      }
  });
});
