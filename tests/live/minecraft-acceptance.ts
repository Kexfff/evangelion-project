// Not picked up by vitest. Explicit opt-in, real server, no LLM or saved profile.
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import mineflayer from "mineflayer";
import { pathfinder } from "mineflayer-pathfinder";
import { MinecraftEngine } from "../../electron/minecraft-engine";
import { minecraftPhysicsCompatibility } from "../../electron/minecraft-physics";
import { minecraftConfigSchema } from "../../src/shared/minecraft";
import { Vec3 } from "vec3";
import { acceptAutonomy } from "./minecraft-autonomy";
import { version } from "../../package.json";

assert.equal(process.env.EVA_MINECRAFT_LIVE, "yes");
const config = minecraftConfigSchema.parse({
  host: "127.0.0.1",
  port: Number(process.env.EVA_MC_PORT || 25556),
  username: "EvaCompanion",
  modifyBlocks: false,
  navigationBlocks: false,
  navigationDoors: false,
  chat: false,
  freePlay: false,
  jobSeconds: 60,
});
const disposable = process.env.EVA_MC_DISPOSABLE === "yes";
const scenario = process.env.EVA_MC_SCENARIO ?? "arena";
assert.ok(
  ["arena", "autonomy", "movement"].includes(scenario),
  "Unknown acceptance scenario",
);
const origin = process.env.EVA_MC_ARENA?.split(",").map(Number);
const restore = process.env.EVA_MC_RETURN?.split(",").map(Number);
if (restore)
  assert.ok(
    disposable && restore.length === 3 && restore.every(Number.isFinite),
    "EVA_MC_RETURN requires three finite coordinates and disposable-world consent",
  );
if (disposable)
  assert.ok(
    origin?.length === 3 && origin.every(Number.isInteger),
    "EVA_MC_ARENA=x,y,z must designate a disposable 25×8×25 area (floor origin).",
  );
const bot = mineflayer.createBot({
  host: config.host,
  port: config.port,
  username: config.username,
  version: config.version,
  auth: "offline",
  respawn: false,
  hideErrors: true,
});
bot.loadPlugin(pathfinder);
bot.loadPlugin(minecraftPhysicsCompatibility);
let engine: MinecraftEngine | undefined;
let failure: Error | undefined;
let ticks = 0;
let returnPosition: Vec3 | undefined;
let returnMode: string | undefined;
let returnTime: number | undefined;
let returnDifficulty: string | undefined;
const messages: string[] = [];
bot.on("messagestr", (message) => {
  messages.push(message);
  if (messages.length > 100) messages.shift();
});
bot.on("error", (error) => {
  failure = error;
});
bot.on("kicked", () => {
  failure = new Error("Server rejected the test client.");
});
bot.on("end", () => {
  failure ??= new Error("Server disconnected.");
});
bot.on("physicsTick", () => {
  ticks++;
  engine?.tick();
});
if (process.env.EVA_MC_VERBOSE === "yes")
  bot.on("path_update", (result) =>
    console.log(
      "PATH",
      JSON.stringify({
        status: result.status,
        nodes: result.path.length,
        route: result.path.map((p) => ({ x: p.x, y: p.y, z: p.z })),
        position: bot.entity.position,
      }),
    ),
  );
async function until(check: () => boolean, label: string, ms = 30000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (failure) throw failure;
    assert.ok(Date.now() < end, `Timed out: ${label}`);
    await delay(100);
  }
}
const deadline = setTimeout(() => {
  failure = new Error("Acceptance deadline reached.");
  bot.end();
}, 480000);
process.once("SIGTERM", () => {
  failure = new Error("Interrupted");
  engine?.stop();
  bot.end();
});
async function command(text: string) {
  assert.ok(disposable, "World setup commands need disposable-world consent");
  bot.chat(`/${text}`);
  await delay(250);
  if (failure) throw failure;
}
async function action(
  name: string,
  args: unknown = {},
  expected = "succeeded",
) {
  const start = Date.now();
  await engine!.call(name, args);
  const heartbeat = setInterval(
    () =>
      console.log(
        "PROGRESS",
        JSON.stringify({
          tool: name,
          position: bot.entity.position,
          controls: bot.controlState,
          detail: engine!.job?.detail,
        }),
      ),
    5000,
  );
  try {
    await until(
      () => engine!.job?.status !== "running",
      `${name}: ${engine!.job?.detail}`,
      75000,
    );
  } finally {
    clearInterval(heartbeat);
  }
  console.log(
    "ACTION",
    JSON.stringify({
      tool: name,
      durationMs: Date.now() - start,
      ...engine!.job,
    }),
  );
  assert.equal(
    engine!.job?.status,
    expected,
    `${name}: ${engine!.job?.detail}`,
  );
  return engine!.job!;
}
function count(item: string) {
  return bot.inventory
    .items()
    .filter((i) => i.name === item)
    .reduce((n, i) => n + i.count, 0);
}
async function movementAndFood() {
  const [x, y, z] = origin!;
  const target = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: "EvaTestTarget",
    version: config.version,
    auth: "offline",
    respawn: false,
    hideErrors: true,
  });
  target.loadPlugin(minecraftPhysicsCompatibility);
  let targetFailure: Error | undefined;
  target.on("error", (error) => {
    targetFailure = error;
  });
  try {
    await until(() => {
      if (targetFailure) throw targetFailure;
      return !!target.entity && !!target.health;
    }, "test follower target spawn");
    await command(`tp EvaTestTarget ${x + 21.5} ${y + 1} ${z + 21.5}`);
    await command(`tp ${bot.username} ${x + 16.5} ${y + 1} ${z + 21.5}`);
    await until(() => !!bot.players.EvaTestTarget?.entity, "target tracking");
    await engine!.call("follow_player", { player: "EvaTestTarget" });
    await until(
      () =>
        bot.entity.position.distanceTo(
          bot.players.EvaTestTarget.entity!.position,
        ) <= 4,
      "follow arrival",
    );
    await command(`tp EvaTestTarget ${x + 15.5} ${y + 1} ${z + 8.5}`);
    await until(
      () =>
        bot.players.EvaTestTarget.entity!.position.z < z + 10 &&
        bot.entity.position.distanceTo(
          bot.players.EvaTestTarget.entity!.position,
        ) <= 4,
      "moving target reacquisition",
    );
    await command(
      `tp EvaTestTarget ${bot.entity.position.x + 1.5} ${bot.entity.position.y} ${bot.entity.position.z}`,
    );
    await delay(1200);
    const before = bot.entity.position.clone();
    const healthBefore = bot.health;
    let displacement = 0;
    const track = () => {
      displacement = Math.max(
        displacement,
        bot.entity.position.distanceTo(before),
      );
    };
    bot.on("physicsTick", track);
    try {
      await until(
        () => !!target.players[bot.username]?.entity,
        "test target sees Eva",
      );
      await target.lookAt(
        target.players[bot.username].entity!.position.offset(0, 1, 0),
      );
      target.attack(target.players[bot.username].entity!);
      await until(
        () => displacement > 0.2 && bot.health < healthBefore,
        "knockback while following",
        5000,
      );
      assert.equal(engine!.job?.status, "running");
    } finally {
      bot.off("physicsTick", track);
      engine!.stop();
    }
    assert.equal(engine!.job?.status, "cancelled");
    console.log(
      "PASS: follow, moving-target reacquisition, knockback and Stop",
      JSON.stringify({ displacement }),
    );
    returnDifficulty ??= bot.game.difficulty;
    await command("difficulty normal");
    await command(`effect give ${bot.username} hunger 8 255 true`);
    await until(() => bot.food < 18, "test hunger", 10000);
    await command(`effect clear ${bot.username} minecraft:hunger`);
    const hungerBefore = bot.food;
    await action("eat_food", { item: "bread" });
    assert.ok(bot.food > hungerBefore);
    console.log("PASS: eating restores observed hunger");
  } finally {
    engine!.stop();
    target.quit();
  }
}
async function arena() {
  const [x, y, z] = origin!;
  assert.ok(
    y >= -60 && y <= 300 && Math.abs(x) < 29999970 && Math.abs(z) < 29999970,
    "Arena must fit inside world bounds",
  );
  console.log(
    "ARENA",
    JSON.stringify({
      origin,
      size: [25, 8, 25],
      endpoint: `127.0.0.1:${config.port}`,
    }),
  );
  messages.length = 0;
  await command(`data get entity ${bot.username} Pos`);
  await until(
    () => messages.some((m) => m.includes("entity data")),
    "operator permission (grant EvaCompanion operator access)",
    5000,
  );
  returnPosition = bot.entity.position.clone();
  returnMode = bot.game.gameMode;
  const p = (dx: number, dz: number, dy = 1) =>
    new Vec3(x + dx, y + dy, z + dz);
  const xyz = (v: Vec3) => `${v.x} ${v.y} ${v.z}`;
  await command(`gamemode creative ${bot.username}`);
  await command(`tp ${bot.username} ${x + 8.5} ${y + 5} ${z + 12.5}`);
  await until(
    () =>
      bot.entity.position.distanceTo(new Vec3(x + 8.5, y + 5, z + 12.5)) < 2,
    "arena teleport",
  );
  await bot.waitForChunksToLoad();
  // Never clear any blocks outside the explicitly designated disposable volume.
  await command(`fill ${x} ${y} ${z} ${x + 24} ${y + 7} ${z + 24} air`);
  await command(`fill ${x} ${y} ${z} ${x + 24} ${y} ${z + 24} bedrock`);
  await command(
    `fill ${x + 12} ${y + 1} ${z + 3} ${x + 12} ${y + 4} ${z + 21} oak_planks`,
  );
  async function closeDoor() {
    for (const [dy, half] of [
      [1, "lower"],
      [2, "upper"],
    ] as const)
      await command(
        `setblock ${xyz(p(12, 7, dy))} oak_door[facing=east,half=${half},hinge=left,open=false]`,
      );
    await until(
      () => bot.blockAt(p(12, 7))?.getProperties().open === false,
      "closed door",
    );
  }
  await closeDoor();
  for (const [dx, dz, block] of [
    [13, 12, "crafting_table"],
    [15, 15, "furnace"],
    [15, 17, "chest"],
  ] as const)
    await command(`setblock ${xyz(p(dx, dz))} ${block}`);
  // An enclosed nearby table must not prevent discovering the usable one.
  await command(
    `fill ${x + 4} ${y + 1} ${z + 10} ${x + 6} ${y + 3} ${z + 12} bedrock`,
  );
  await command(`setblock ${xyz(p(5, 11))} crafting_table`);
  await command(`setblock ${xyz(p(18, 5))} oak_log`);
  await command(`setblock ${xyz(p(18, 6))} stone`);
  for (const [item, quantity] of [
    ["oak_log", 3],
    ["coal", 2],
    ["dirt", 8],
    ["wooden_pickaxe", 1],
    ["bread", 2],
  ] as const)
    await command(`give ${bot.username} ${item} ${quantity}`);
  await command(`tp ${bot.username} ${x + 9.5} ${y + 1} ${z + 12.5}`);
  await command(`gamemode survival ${bot.username}`);
  await until(
    () => bot.entity.position.distanceTo(p(9, 12)) < 2 && bot.entity.onGround,
    "survival start",
  );
  Object.assign(config, {
    freePlay: true,
    modifyBlocks: true,
    navigationDoors: true,
    buildCenter: { x: x + 12, y: y + 2, z: z + 12 },
    buildRadius: 20,
  });
  engine!.ready();

  await action("move_to", p(16, 12));
  assert.equal(bot.blockAt(p(12, 7))?.getProperties().open, true);
  assert.equal(bot.blockAt(p(12, 12))?.name, "oak_planks");
  await closeDoor();
  await action("move_to", p(9, 12));
  assert.equal(bot.blockAt(p(12, 7))?.getProperties().open, true);
  console.log("PASS: closed door crossed from both sides; wall intact");
  await closeDoor();
  const planksBefore = count("oak_planks");
  await action("craft_item", { item: "oak_planks", count: 2 });
  assert.equal(count("oak_planks") - planksBefore, 8);
  await action("craft_item", { item: "stick", count: 1 });
  await action("craft_item", {
    item: "wooden_pickaxe",
    count: 1,
    table: p(5, 11),
  });
  assert.ok(engine!.job?.diagnostics?.some((d) => d.outcome === "reached"));
  assert.ok(
    engine!.job?.diagnostics?.some(
      (d) => d.outcome !== "reached" && d.outcome !== "approaching",
    ),
  );
  assert.equal(bot.blockAt(p(12, 12))?.name, "oak_planks");
  console.log(
    "PASS: enclosed table skipped; reachable table used through door; recipe counts verified",
  );
  await action("equip_item", { item: "wooden_pickaxe", destination: "hand" });
  const cobble = count("cobblestone");
  await action("collect_blocks", { block: "stone", count: 1 });
  assert.ok(count("cobblestone") > cobble);
  await action("craft_item", { item: "stone_pickaxe", count: 1 });
  await action("craft_item", { item: "crafting_table", count: 1 });
  await action("build_blocks", {
    blocks: [
      { ...p(20, 12), block: "crafting_table" },
      { ...p(20, 13), block: "dirt" },
      { ...p(21, 13), block: "dirt" },
    ],
  });
  await action("craft_item", {
    item: "wooden_sword",
    count: 1,
    table: p(20, 12),
  });
  assert.equal(bot.blockAt(p(20, 12))?.name, "crafting_table");
  console.log(
    "PASS: harvesting, pickaxe crafting, bench placement/use and small build",
  );
  await action(
    "build_blocks",
    {
      blocks: [
        { ...p(20, 14), block: "dirt" },
        { ...p(20, 12), block: "dirt" },
      ],
    },
    "failed",
  );
  assert.equal(engine!.job?.progress, 1);
  assert.equal(bot.blockAt(p(20, 14))?.name, "dirt");
  assert.equal(bot.blockAt(p(20, 12))?.name, "crafting_table");
  console.log("PASS: partial build preserved and reported failed");
  await action("move_to", p(9, 12));
  await closeDoor();
  const dirt = count("dirt");
  await action("container", {
    position: p(15, 17),
    action: "deposit",
    item: "dirt",
    count: 2,
  });
  assert.equal(count("dirt"), dirt - 2);
  await action("container", {
    position: p(15, 17),
    action: "withdraw",
    item: "dirt",
    count: 2,
  });
  assert.equal(count("dirt"), dirt);
  await action("furnace", {
    position: p(15, 15),
    action: "put_input",
    item: "cobblestone",
    count: 1,
  });
  await action("furnace", {
    position: p(15, 15),
    action: "put_fuel",
    item: "coal",
    count: 1,
  });
  let output = false;
  const end = Date.now() + 20000;
  while (!output && Date.now() < end) {
    await delay(1000);
    const job = await action("furnace", {
      position: p(15, 15),
      action: "inspect",
    });
    output =
      (job.result?.output as { name?: string } | undefined)?.name === "stone";
  }
  assert.ok(output, "Furnace must actually smelt");
  await action("furnace", { position: p(15, 15), action: "take_output" });
  console.log("PASS: storage round trip and completed smelting");
  await action("drop_items", { item: "dirt", count: 1 });
  await action("equip_item", { item: "wooden_sword", destination: "hand" });
  returnDifficulty = bot.game.difficulty;
  await command("difficulty normal");
  await command(
    `summon husk ${xyz(p(20, 19))} {NoAI:1b,PersistenceRequired:1b,Tags:["eva_acceptance"]}`,
  );
  await until(
    () => Object.values(bot.entities).some((e) => e.name === "husk"),
    "combat target",
  );
  const target = Object.values(bot.entities).find((e) => e.name === "husk")!;
  await action("attack_entity", {
    entityId: target.id,
    mode: "fight",
    seconds: 45,
  });
  console.log("PASS: drop, equipment and combat");
  for (const [dz, part] of [
    [4, "foot"],
    [5, "head"],
  ] as const)
    await command(
      `setblock ${xyz(p(20, dz))} red_bed[facing=south,part=${part}]`,
    );
  returnTime = bot.time.timeOfDay;
  await command("time set midnight");
  await action("sleep", { position: p(20, 4) });
  assert.ok(bot.isSleeping);
  await action("wake");
  assert.ok(!bot.isSleeping);
  console.log("PASS: sleep and wake");
  await movementAndFood();
  if (process.env.EVA_MC_PAID_REQUESTS === "10") await acceptAutonomy(engine!);
}
async function main() {
  await until(
    () => !!bot.entity && !!bot.health && ticks > 10,
    "spawn and physics",
  );
  await bot.waitForChunksToLoad();
  engine = new MinecraftEngine(config, bot, () => {});
  engine.ready();
  console.log(
    "ACCEPTANCE",
    JSON.stringify({
      version,
      scenario: disposable ? scenario : "observe",
      at: new Date().toISOString(),
      endpoint: `127.0.0.1:${config.port}`,
    }),
  );
  if (scenario === "autonomy" || scenario === "movement") {
    assert.ok(disposable);
    returnPosition = bot.entity.position.clone();
    returnMode = bot.game.gameMode;
    const [x, y, z] = origin!;
    await command(`tp ${bot.username} ${x + 19.5} ${y + 1} ${z + 10.5}`);
    await until(() => bot.entity.position.y > y, "arena teleport");
    await bot.waitForChunksToLoad();
    Object.assign(config, {
      freePlay: true,
      modifyBlocks: true,
      navigationDoors: true,
      buildCenter: { x: x + 12, y: y + 2, z: z + 12 },
      buildRadius: 20,
    });
    engine.ready();
    if (scenario === "movement") {
      await movementAndFood();
      return;
    }
    if (count("wooden_pickaxe") > 1)
      await action("container", {
        position: { x: x + 15, y: y + 1, z: z + 17 },
        action: "deposit",
        item: "wooden_pickaxe",
        count: count("wooden_pickaxe") - 1,
      });
    await acceptAutonomy(engine);
    return;
  }
  console.log(
    "OBSERVED",
    JSON.stringify({
      position: bot.entity.position,
      health: bot.health,
      food: bot.food,
      players: Object.keys(bot.players),
    }),
  );
  assert.ok(ticks > 10, "Physics must advance");
  console.log("PASS: connected, chunks loaded, physics advancing");
  if (disposable) await arena();
}
void main()
  .catch((error) => {
    console.error(error);
    console.error("RECENT_SERVER_MESSAGES", JSON.stringify(messages.slice(-5)));
    process.exitCode = 1;
  })
  .finally(async () => {
    clearTimeout(deadline);
    engine?.dispose();
    if (disposable && !failure && returnPosition) {
      try {
        if (returnTime !== undefined) await command(`time set ${returnTime}`);
        if (returnDifficulty !== undefined)
          await command(`difficulty ${returnDifficulty}`);
        const destination = restore
          ? new Vec3(...(restore as [number, number, number]))
          : returnPosition;
        await command(
          `tp ${bot.username} ${destination.x} ${destination.y} ${destination.z}`,
        );
        await command(`gamemode ${returnMode} ${bot.username}`);
      } catch (error) {
        console.error("Could not restore test client's position/mode:", error);
        process.exitCode = 1;
      }
    }
    bot.quit();
    // Mineflayer dependencies can retain handles after disconnection.
    setTimeout(() => process.exit(process.exitCode ?? 0), 1500).unref();
  });
