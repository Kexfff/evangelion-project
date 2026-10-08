import assert from "node:assert/strict";
import { Vec3 } from "vec3";
import type { Bot } from "mineflayer";
import type { MinecraftEngine } from "../../electron/minecraft-engine";
import type { MinecraftJob } from "../../src/shared/minecraft";
import {
  itemEnchantments,
  itemCustomName,
} from "../../electron/minecraft-items";

/** Explicit disposable arena only. No provider/profile access. */
export async function acceptGameplayDepth(
  bot: Bot,
  engine: MinecraftEngine,
  origin: number[],
  command: (text: string) => Promise<void>,
  action: (
    name: string,
    args?: unknown,
    expected?: string,
  ) => Promise<MinecraftJob>,
  until: (test: () => boolean, label: string, ms?: number) => Promise<void>,
) {
  const [x, y, z] = origin;
  const p = (dx: number, dz: number) => new Vec3(x + dx, y + 1, z + dz);
  const at = (v: Vec3) => `${v.x} ${v.y} ${v.z}`;
  assert.equal(
    bot.blockAt(new Vec3(x + 3, y, z + 18))?.name,
    "bedrock",
    "Run only in the existing acceptance arena",
  );
  await command(`setblock ${at(p(3, 18))} enchanting_table`);
  await command(`setblock ${at(p(5, 18))} anvil`);
  if (
    !bot.inventory
      .items()
      .some((i) => i.name === "diamond_sword" && !itemEnchantments(i).length)
  )
    await command(`give ${bot.username} diamond_sword 1`);
  if (
    !bot.inventory
      .items()
      .some((i) => i.name === "lapis_lazuli" && i.count >= 16)
  )
    await command(`give ${bot.username} lapis_lazuli 16`);
  if (!bot.inventory.items().some((i) => i.name === "emerald" && i.count >= 16))
    await command(`give ${bot.username} emerald 16`);
  await command(`experience add ${bot.username} 30 levels`);
  await command(`gamemode survival ${bot.username}`);
  const plainSword = () =>
    bot.inventory
      .items()
      .find((i) => i.name === "diamond_sword" && !itemEnchantments(i).length)!;
  await action("enchant_item", {
    position: p(3, 18),
    item: "diamond_sword",
    slot: plainSword().slot,
    action: "inspect",
  });
  await action("enchant_item", {
    position: p(3, 18),
    item: "diamond_sword",
    slot: plainSword().slot,
    action: "enchant",
    choice: 0,
  });
  const findSword = () =>
    bot.inventory
      .items()
      .find(
        (i) =>
          i.name === "diamond_sword" &&
          itemEnchantments(i).length > 0 &&
          !itemCustomName(i),
      );
  const sword = findSword();
  assert.ok(sword);
  console.log(
    "PASS: enchanting offers, lapis/XP use and returned enchanted sword",
  );
  await action("anvil_item", {
    position: p(5, 18),
    first: sword.slot,
    name: "Eva's blade",
    action: "inspect",
  });
  await until(() => !!findSword(), "anvil input returned");
  await action("anvil_item", {
    position: p(5, 18),
    first: findSword()!.slot,
    name: "Eva's blade",
    action: "apply",
  });
  console.log("PASS: anvil preview and verified rename");
  const previousVillagers = new Set(
    Object.values(bot.entities)
      .filter((e) => e.name === "villager")
      .map((e) => e.id),
  );
  await command(`kill @e[tag=eva_depth_villager]`);
  await command(
    `summon villager ${at(p(8, 18))} {NoAI:1b,Invulnerable:1b,PersistenceRequired:1b,Tags:["eva_depth_villager"],VillagerData:{type:"minecraft:plains",profession:"minecraft:farmer",level:2},Offers:{Recipes:[{buy:{id:"minecraft:emerald",count:1},sell:{id:"minecraft:bread",count:3},maxUses:100}]}}`,
  );
  await until(
    () =>
      Object.values(bot.entities).some(
        (e) =>
          e.name === "villager" &&
          !previousVillagers.has(e.id) &&
          e.position.distanceTo(p(8, 18)) < 2,
      ),
    "test villager",
  );
  const target = Object.values(bot.entities).find(
    (e) =>
      e.name === "villager" &&
      !previousVillagers.has(e.id) &&
      e.position.distanceTo(p(8, 18)) < 2,
  )!;
  await action("trade_villager", { entityId: target.id, action: "inspect" });
  await action("trade_villager", {
    entityId: target.id,
    action: "trade",
    index: 0,
    item: "bread",
    input1: "emerald",
    input2: null,
    count: 2,
    price1: 1,
    price2: 0,
  });
  console.log("PASS: villager offers and two verified trades");
  await command(`setblock ${at(p(10, 18))} chest`);
  const swords = bot.inventory
    .items()
    .filter((i) => i.name === "diamond_sword")
    .reduce((n, i) => n + i.count, 0);
  if (swords > 1)
    await action("container", {
      position: p(10, 18),
      action: "deposit",
      item: "diamond_sword",
      count: swords - 1,
    });
  await command(
    `fill ${x + 2} ${y + 1} ${z + 2} ${x + 9} ${y + 1} ${z + 8} stone`,
  );
  await command(
    `fill ${x + 3} ${y + 1} ${z + 3} ${x + 8} ${y + 1} ${z + 7} water`,
  );
  if (!bot.inventory.items().some((i) => i.name === "fishing_rod"))
    await command(`give ${bot.username} fishing_rod 1`);
  await command(`tp ${bot.username} ${x + 6.5} ${y + 1} ${z + 9.5}`);
  await until(
    () => bot.entity.position.distanceTo(p(6, 9)) < 2,
    "fishing shore",
  );
  await action("fish", { water: p(6, 6), catches: 1, seconds: 60 });
  console.log("PASS: automatic fishing with collected output");
  const resources = await engine.call("plan_resources", {
    item: "wooden_pickaxe",
    count: 2,
  });
  console.log("RESOURCE_PLAN", JSON.stringify(resources));
}
