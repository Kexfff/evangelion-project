// Opt-in, bounded movement-only diagnostic. Never reads or writes app settings.
import mineflayer from "mineflayer";
import pathfinding from "mineflayer-pathfinder";
import { MinecraftEngine } from "../electron/minecraft-engine.ts";
import { minecraftConfigSchema } from "../src/shared/minecraft.ts";
import { minecraftPhysicsCompatibility } from "../electron/minecraft-physics.ts";
const { pathfinder } = pathfinding;

if (process.env.EVA_MINECRAFT_LIVE !== "yes")
  throw new Error("Live-world opt-in required.");
const bot = mineflayer.createBot({
  host: "127.0.0.1",
  port: Number(process.env.EVA_MC_PORT || 25556),
  username: "EvaCompanion",
  version: "26.1",
  auth: "offline",
  respawn: false,
  hideErrors: true,
});
bot.loadPlugin(pathfinder);
bot.loadPlugin(minecraftPhysicsCompatibility);
let engine;
let ticks = 0,
  writes = 0,
  started = false;
bot.on("physicsTick", () => ticks++);
const write = bot._client.write.bind(bot._client);
bot._client.write = (name, data) => {
  if (["position", "position_look", "flying", "look"].includes(name)) writes++;
  return write(name, data);
};
bot.loadPlugin(() => {
  bot._client.on("entity_velocity", (p) => {
    if (p.entityId === bot.entity?.id)
      console.log(
        "KNOCKBACK",
        JSON.stringify({ packet: p.velocity, applied: bot.entity.velocity }),
      );
  });
});
bot._client.on("position", (p) =>
  console.log(
    "SERVER_POSITION",
    JSON.stringify({ x: p.x, y: p.y, z: p.z, flags: p.flags }),
  ),
);
bot.on("path_update", (p) =>
  console.log(
    "PATH",
    JSON.stringify({ status: p.status, nodes: p.path.length, time: p.time }),
  ),
);
bot.once("spawn", () => {
  started = true;
  engine = new MinecraftEngine(
    minecraftConfigSchema.parse({
      movement: true,
      modifyBlocks: false,
      chat: false,
      freePlay: false,
      trustedPlayer: process.env.EVA_MC_PLAYER || "Lexxass",
    }),
    bot,
    () => {},
  );
  engine.ready();
  void engine.call("follow_player", {});
  console.log("READY: movement only; hit Eva once to test knockback.");
});
const timer = setInterval(() => {
  if (!started) return;
  const target = bot.players[process.env.EVA_MC_PLAYER || "Lexxass"]?.entity;
  engine?.tick();
  console.log(
    "HEALTH",
    JSON.stringify({
      ticks,
      writes,
      state: bot._client.state,
      alive: bot.isAlive,
      physics: bot.physicsEnabled,
      position: bot.entity.position,
      velocity: bot.entity.velocity,
      onGround: bot.entity.onGround,
      loaded: !!bot.blockAt(bot.entity.position),
      target: target?.position,
      health: bot.health,
      job: engine?.job?.detail,
    }),
  );
  ticks = writes = 0;
}, 2000);
let closing = false;
function close() {
  if (closing) return;
  closing = true;
  clearInterval(timer);
  engine?.stop();
  bot.pathfinder.setGoal(null);
  bot.clearControlStates();
  bot.quit();
  setTimeout(() => process.exit(0), 1000).unref();
}
bot.on("error", (e) => {
  console.error(e.message);
  close();
});
bot.on("kicked", (r) => {
  console.log("KICKED", r);
  close();
});
bot.on("end", () => {
  clearInterval(timer);
});
process.on("SIGINT", close);
process.on("SIGTERM", close);
setTimeout(close, 90000).unref();
