// Bounded schemas for app-shipped gameplay tools. No arbitrary command/code tool.
const item = { type: "string", minLength: 1, maxLength: 100 } as const;
const point = {
  type: "object",
  properties: {
    x: { type: "integer", minimum: -30000000, maximum: 30000000 },
    y: { type: "integer", minimum: -2048, maximum: 2048 },
    z: { type: "integer", minimum: -30000000, maximum: 30000000 },
  },
  required: ["x", "y", "z"],
  additionalProperties: false,
} as const;
const count = { type: "integer", minimum: 1, maximum: 1024 } as const;
const entityId = { type: "integer", minimum: 0 } as const;
function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
) {
  return {
    name,
    description,
    inputSchema: {
      type: "object" as const,
      properties,
      required,
      additionalProperties: false,
    },
  };
}
export const minecraftGameplayTools = [
  tool(
    "enchant_item",
    "Approach an enchanting table with an unenchanted inventory item. action=inspect returns the current three offers after inserting the item, then returns the item. action=enchant selects choice 0..2, rechecks required XP/lapis and verifies enchantments on the returned item. Choice costs 1..3 levels/lapis; offers can change. Optional slot distinguishes stacks.",
    {
      position: point,
      item,
      slot: { type: "integer", minimum: 0, maximum: 45 },
      action: { type: "string", enum: ["inspect", "enchant"] },
      choice: { type: "integer", minimum: 0, maximum: 2 },
    },
    ["position", "item", "action"],
  ),
  tool(
    "anvil_item",
    "Approach an anvil to inspect a repair/combine/rename preview or execute it. Select exact inventory slots (first and optional second); name optionally renames. Uses Minecraft's own output/XP preview and verifies returned output metadata/durability. Inputs preserve the chosen left/right order. Inspect may relocate returned input slots; re-read inspect_inventory before apply. Does not discard items deliberately; failures may be partial, so inspect before retrying.",
    {
      position: point,
      first: { type: "integer", minimum: 9, maximum: 44 },
      second: { type: "integer", minimum: 9, maximum: 44 },
      name: { type: "string", minLength: 1, maxLength: 35 },
      action: { type: "string", enum: ["inspect", "apply"] },
    },
    ["position", "first", "action"],
  ),
  tool(
    "fish",
    "Automatically cast and reel a fishing rod near water, verifying collected inventory gains after each catch. Stand on the shore with a clear cast first. Optional water is a nearby loaded water block; otherwise finds water within 6 blocks. Stops on an uncollected catch, timeout, cancellation or broken rod; no blind recast after an uncertain result.",
    {
      water: point,
      catches: { type: "integer", minimum: 1, maximum: 16 },
      seconds: { type: "integer", minimum: 5, maximum: 90 },
    },
  ),
  tool(
    "trade_villager",
    "Approach a villager and inspect offers or execute one freshly matched offer. Results include offer indices, prices, output and availability. For trade supply index, expected input1 and input2 item IDs (input2=null if absent), output item, max unit prices (price1/price2) and count of operations. Rejects changed prices/output or disabled offers. Verifies inventory output per operation; closes the window. Villagers only; wandering trader support depends on upstream and is not claimed.",
    {
      entityId,
      action: { type: "string", enum: ["inspect", "trade"] },
      index: { type: "integer", minimum: 0, maximum: 99 },
      item,
      count: { type: "integer", minimum: 1, maximum: 64 },
      price1: count,
      price2: { type: "integer", minimum: 0, maximum: 1024 },
      input1: item,
      input2: { anyOf: [item, { type: "null" }] },
    },
    ["entityId", "action"],
  ),
  tool(
    "steer_vehicle",
    "Send bounded left/forward steering input to the currently mounted vehicle; left=-1 means right. Reports observed displacement, not arrival. Mount first; server/vehicle may not support steering (rails, saddles/control items and protocol support still apply). Always releases input on Stop or timeout; does not implement boat physics or route planning.",
    {
      left: { type: "number", minimum: -1, maximum: 1 },
      forward: { type: "number", minimum: -1, maximum: 1 },
      milliseconds: { type: "integer", minimum: 100, maximum: 5000 },
    },
    ["left", "forward", "milliseconds"],
  ),
  tool(
    "plan_resources",
    "Analyze crafting prerequisites for a target TOTAL carried stock. Accounts for recipe output quantities and shared ingredients; returns missing acquisition leaves and ordered craft operations, not actions. Bounded search; recompute after inventory changes or partial effects. No exploration, smelting or tool/drop assumptions.",
    { item, count: { type: "integer", minimum: 1, maximum: 4096 } },
    ["item", "count"],
  ),
  tool(
    "inspect_inventory",
    "Inspect inventory slots, equipment, held item and hunger. Use exact item names and optional slots to distinguish stacks. Does not interrupt an action.",
    {},
  ),
  tool(
    "find_blocks",
    "Find a block type in loaded chunks, sorted by distance. Does not explore unloaded terrain or interrupt actions.",
    {
      block: item,
      radius: { type: "integer", minimum: 1, maximum: 128 },
      limit: { type: "integer", minimum: 1, maximum: 32 },
    },
    ["block"],
  ),
  tool(
    "drop_items",
    "Drop a specified quantity from inventory into the world. Optional slot selects an exact stack. Returns background action status; verify result before claiming delivery to a player.",
    { item, count, slot: { type: "integer", minimum: 0, maximum: 45 } },
    ["item", "count"],
  ),
  tool(
    "equip_item",
    "Equip an inventory item in hand, off-hand or armor slot; use item=null to unequip. Optional slot selects an exact stack.",
    {
      item: { anyOf: [item, { type: "null" }] },
      destination: {
        type: "string",
        enum: ["hand", "off-hand", "head", "torso", "legs", "feet"],
      },
      slot: { type: "integer", minimum: 0, maximum: 45 },
    },
    ["item", "destination"],
  ),
  tool(
    "eat_food",
    "Eat/drink one named inventory item, or choose available food if omitted. Reports verified hunger/item changes, not healing assumptions.",
    { item },
  ),
  tool(
    "sleep",
    "Walk to a bed and sleep. Omit position to find a nearby bed. Normal Minecraft night, occupied-bed and nearby-monster rules apply. Beds outside the Overworld cannot be used for sleeping.",
    { position: point },
  ),
  tool("wake", "Wake from bed without moving elsewhere.", {}),
  tool(
    "attack_entity",
    "Approach and attack a specific currently observed entity ID with the held weapon. mode=hit sends one melee attack; mode=fight repeats with cooldown until a death event or timeout. A lost/untracked target is NOT a confirmed kill. Optional entityUuid prevents stale numeric-ID reuse. equipBest=true equips the strongest available material-tier sword/axe (not an enchantment optimizer). Optional retreatHealth (0 disables) stops fighting at low health; retreatTo gives an explicit retreat waypoint. Never selects other targets automatically.",
    {
      entityId,
      entityUuid: { type: "string", minLength: 36, maxLength: 36 },
      equipBest: { type: "boolean" },
      retreatHealth: { type: "number", minimum: 0, maximum: 20 },
      retreatTo: point,
      mode: { type: "string", enum: ["hit", "fight"] },
      seconds: { type: "integer", minimum: 1, maximum: 120 },
    },
    ["entityId"],
  ),
  tool(
    "interact_entity",
    "Right-click an observed entity with the held item (feeding, shearing, trading interaction, etc.), or mount/dismount. For dismount no target is needed. Opening an interaction is not proof of a trade/feed result.",
    {
      action: { type: "string", enum: ["interact", "mount", "dismount"] },
      entityId,
    },
    ["action"],
  ),
  tool(
    "interact_block",
    "Approach and right-click a block with the held item: doors, buttons, levers, planting or other vanilla interactions. Observation reports resulting block state; use container/furnace tools for inventory transfers. Does not claim a changed block proves every interaction's intended outcome.",
    { position: point },
    ["position"],
  ),
  tool(
    "use_item",
    "Use the held main-hand item for a bounded duration then release (e.g. bow, shield, throwables). Optional aim coordinates. May consume the item or fire a projectile; result confirms input sent, not a hit.",
    {
      aim: point,
      milliseconds: { type: "integer", minimum: 0, maximum: 5000 },
    },
  ),
  tool(
    "look_at",
    "Look at world coordinates. Does not move the player.",
    { position: point },
    ["position"],
  ),
  tool(
    "dig_block",
    "Approach and break exactly the block at given coordinates. Uses the held tool; equip a suitable tool first. Verifies the block changed, not that its drop was collected.",
    { position: point },
    ["position"],
  ),
  tool(
    "get_recipes",
    "List recipes for an item and whether inventory can currently craft them, with ingredients, output count and crafting-table requirement. Does not interrupt actions.",
    { item },
    ["item"],
  ),
  tool(
    "craft_item",
    "Craft an item using current inventory. Automatically finds a loaded crafting table within 32 blocks when needed and walks to a reachable, unobstructed interaction position. Optional table is a preferred table BLOCK coordinate, not a base/floor coordinate; stale hints fall back to discovery. Inventory-only recipes need no table. count means crafting operations, NOT output items. Does not gather ingredients or place a table. Reports actual output inventory gain.",
    { item, count: { type: "integer", minimum: 1, maximum: 64 }, table: point },
    ["item", "count"],
  ),
  tool(
    "container",
    "Approach a chest/barrel/shulker/dispenser/hopper and inspect, deposit or withdraw items. Results are in job_status.result. Explicit item/count required for transfers; closes its window after use. Does not target furnace or crafting windows.",
    {
      position: point,
      action: { type: "string", enum: ["inspect", "deposit", "withdraw"] },
      item,
      count,
    },
    ["position", "action"],
  ),
  tool(
    "furnace",
    "Approach a furnace/smoker/blast furnace. Inspect slots/progress, insert named input or fuel with count, or take one entire slot stack. Does not wait for smelting or claim input insertion means output is ready. Reinspect later.",
    {
      position: point,
      action: {
        type: "string",
        enum: [
          "inspect",
          "put_input",
          "put_fuel",
          "take_input",
          "take_fuel",
          "take_output",
        ],
      },
      item,
      count,
    },
    ["position", "action"],
  ),
] as const;

export const minecraftMovementTools = [
  "fish",
  "enchant_item",
  "anvil_item",
  "trade_villager",
  "steer_vehicle",
  "move_to",
  "follow_player",
  "collect_blocks",
  "build_blocks",
  "sleep",
  "attack_entity",
  "interact_entity",
  "interact_block",
  "dig_block",
  "craft_item",
  "container",
  "furnace",
];
