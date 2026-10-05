import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { Vec3 } from "vec3";
import {
  MinecraftActions,
  type GameplayHost,
} from "../electron/minecraft-actions";
import { MinecraftActionError } from "../electron/minecraft-action-error";
import {
  minecraftTools,
  minecraftLiveSchema,
  minecraftJobSchema,
} from "../src/shared/minecraft";
import { compileMcpTool } from "../electron/mcp-plugin";

afterEach(() => vi.useRealTimers());
const p = { x: 3, y: 64, z: 0 };
function fixture() {
  const slots: any[] = Array(46).fill(null);
  const add = (name: string, count: number, slot = 9) => {
    const type =
      {
        stone: 1,
        bread: 2,
        oak_planks: 3,
        coal: 4,
        iron_ingot: 5,
        iron_sword: 6,
      }[name] ?? 7;
    return (slots[slot] = {
      name,
      count,
      slot,
      type,
      metadata: 0,
      durabilityUsed: 0,
    });
  };
  add("stone", 12);
  add("bread", 3, 10);
  add("coal", 8, 11);
  const bot: any = new EventEmitter();
  let block: any = {
    name: "stone",
    stateId: 1,
    position: new Vec3(p.x, p.y, p.z),
  };
  const storage = [{ name: "stone", count: 20, slot: 0, type: 1, metadata: 0 }];
  let windowItems: any[] = [];
  const window: any = {
    items: () => windowItems.filter((i) => i && i.count > 0),
    containerItems: () => storage,
    close: vi.fn(async () => {
      windowItems.forEach((i) => {
        slots[i.slot] = { ...i };
      });
      bot.currentWindow = null;
    }),
    deposit: vi.fn(async (_type, _metadata, count) => {
      windowItems[0].count -= count;
      storage[0].count += count;
    }),
    withdraw: vi.fn(async (_type, _metadata, count) => {
      windowItems[0].count += count;
      storage[0].count -= count;
    }),
    inputItem: () => null,
    fuelItem: () => null,
    outputItem: () => ({
      name: "iron_ingot",
      count: 2,
      type: 5,
      slot: 2,
      metadata: 0,
    }),
    putInput: vi.fn(async (_type, _meta, count) => {
      windowItems[0].count -= count;
    }),
    putFuel: vi.fn(async (_type, _meta, count) => {
      windowItems.find((i) => i.name === "coal").count -= count;
    }),
    takeOutput: vi.fn(async () => {
      windowItems.push({ name: "iron_ingot", count: 2, slot: 12, type: 5 });
    }),
    takeInput: vi.fn(),
    takeFuel: vi.fn(),
    progress: 0.5,
  };
  const open = vi.fn(async () => {
    windowItems = bot.inventory.items().map((i: any) => ({ ...i }));
    bot.currentWindow = window;
    return window;
  });
  Object.assign(bot, {
    inventory: {
      slots,
      items: () => slots.slice(9, 45).filter((i) => i && i.count > 0),
    },
    entity: { id: 1, position: new Vec3(0, 64, 0) },
    entities: {},
    currentWindow: null,
    heldItem: slots[9],
    food: 12,
    health: 20,
    isSleeping: false,
    game: { dimension: "overworld" },
    registry: {
      blocksByName: { stone: { id: 1 } },
      itemsByName: { oak_planks: { id: 3 } },
      items: { 1: { name: "stone" } },
      foodsByName: { bread: { foodPoints: 5 } },
    },
    blockAt: vi.fn(() => block),
    canSeeBlock: vi.fn(() => true),
    canDigBlock: vi.fn(() => true),
    digTime: () => 100,
    findBlock: vi.fn(() => block),
    findBlocks: vi.fn(() => [new Vec3(8, 64, 0), new Vec3(3, 64, 0)]),
    toss: vi.fn(async (type, _meta, count) => {
      slots.find((i) => i?.type === type).count -= count;
    }),
    transfer: vi.fn(async (o: any) => {
      slots[o.sourceStart].count -= o.count;
    }),
    equip: vi.fn(async (item, dest: string) => {
      if (dest === "hand") bot.heldItem = item;
      else
        slots[
          (
            { head: 5, torso: 6, legs: 7, feet: 8, "off-hand": 45 } as Record<
              string,
              number
            >
          )[dest]
        ] = item;
    }),
    unequip: vi.fn(async (dest) => {
      if (dest === "hand") bot.heldItem = null;
    }),
    consume: vi.fn(async () => {
      bot.heldItem.count--;
      bot.food += 5;
    }),
    activateItem: vi.fn(),
    deactivateItem: vi.fn(),
    isABed: (b: any) => b.name.endsWith("_bed"),
    sleep: vi.fn(async () => {
      bot.isSleeping = true;
    }),
    wake: vi.fn(async () => {
      bot.isSleeping = false;
    }),
    lookAt: vi.fn(async () => {}),
    activateBlock: vi.fn(async () => {}),
    activateEntity: vi.fn(async () => {}),
    dig: vi.fn(async () => {
      block = { ...block, name: "air", stateId: 0 };
    }),
    pathfinder: { setGoal: vi.fn() },
    entityAtCursor: vi.fn(),
    attack: vi.fn(),
    mount: vi.fn((entity) => {
      bot.vehicle = entity;
    }),
    dismount: vi.fn(() => {
      bot.vehicle = null;
    }),
    recipesFor: vi.fn(() => [
      {
        delta: [{ id: 1, count: -1 }],
        result: { count: 4 },
        requiresTable: false,
      },
    ]),
    recipesAll: vi.fn(() => [
      {
        delta: [{ id: 1, count: -1 }],
        result: { count: 4 },
        requiresTable: false,
      },
    ]),
    craft: vi.fn(async () => {
      const existing = slots[13];
      add("oak_planks", (existing?.count ?? 0) + 4, 13);
    }),
    openContainer: open,
    openFurnace: open,
    closeWindow: vi.fn(async () => window.close()),
  });
  const controller = new AbortController();
  const host: GameplayHost = {
    start: (_kind, work) => work(controller.signal),
    check: (s) => s.throwIfAborted(),
    navigate: vi.fn(async (target) => {
      bot.entity.position = target.clone();
    }),
    approachBlock: vi.fn(async (target) => {
      bot.entity.position = target.clone();
    }),
    area: vi.fn(),
    progress: vi.fn(),
    until: vi.fn(async (test, signal) => {
      signal.throwIfAborted();
      if (!test())
        throw new MinecraftActionError("Expected world change did not occur.");
    }),
  };
  const actions = new MinecraftActions(bot, host);
  const target = {
    id: 2,
    name: "zombie",
    height: 1.8,
    position: new Vec3(1, 64, 0),
    isValid: true,
  };
  bot.entities[2] = target;
  bot.entityAtCursor.mockReturnValue(target);
  return {
    bot,
    host,
    actions,
    add,
    slots,
    controller,
    target,
    window,
    open,
    setBlock: (name: string) => {
      block = { ...block, name };
    },
  };
}

describe("Minecraft everyday gameplay", () => {
  it("registers all 26 tools with host-valid schemas and entity-aware observation", () => {
    expect(minecraftTools).toHaveLength(26);
    for (const tool of minecraftTools)
      expect(
        compileMcpTool(JSON.parse(JSON.stringify(tool)), "builtin-minecraft")
          .name,
      ).toBe(tool.name);
    expect(
      minecraftLiveSchema.parse({
        connected: true,
        status: "Connected",
        nearby: [
          {
            id: 2,
            name: "zombie",
            type: "mob",
            kind: "Hostile mobs",
            position: p,
          },
        ],
      }).nearby[0].id,
    ).toBe(2);
  });
  it("inspects inventory and locates loaded blocks without starting an action", async () => {
    const h = fixture();
    h.host.start = vi.fn();
    expect(await h.actions.call("inspect_inventory", {})).toMatchObject({
      food: 12,
      held: { name: "stone" },
    });
    expect(
      await h.actions.call("find_blocks", { block: "stone" }),
    ).toMatchObject({
      loadedChunksOnly: true,
      positions: [new Vec3(3, 64, 0), new Vec3(8, 64, 0)],
    });
    expect(h.host.start).not.toHaveBeenCalled();
  });
  it("drops requested quantities and exact partial stacks without claiming recipient delivery", async () => {
    const h = fixture();
    expect(
      await h.actions.call("drop_items", { item: "stone", count: 3 }),
    ).toMatchObject({ count: 3 });
    expect(h.slots[9].count).toBe(9);
    await h.actions.call("drop_items", { item: "stone", count: 2, slot: 9 });
    expect(h.bot.transfer).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceStart: 9,
        sourceEnd: 10,
        count: 2,
        destStart: -999,
      }),
    );
    await expect(
      h.actions.call("drop_items", { item: "stone", count: 100 }),
    ).rejects.toThrow("Not enough");
    expect(h.bot.toss).toHaveBeenCalledTimes(1);
  });
  it("equips armor/hand and never silently drops an item to unequip a full inventory", async () => {
    const h = fixture();
    await h.actions.call("equip_item", { item: "bread", destination: "hand" });
    expect(h.bot.heldItem.name).toBe("bread");
    await h.actions.call("equip_item", {
      item: "stone",
      destination: "off-hand",
    });
    expect(h.slots[45].name).toBe("stone");
    for (let i = 9; i < 45; i++) h.add("stone", 1, i);
    await expect(
      h.actions.call("equip_item", { item: null, destination: "hand" }),
    ).rejects.toThrow("Inventory is full");
    expect(h.bot.unequip).not.toHaveBeenCalled();
    expect(h.bot.toss).not.toHaveBeenCalled();
  });
  it("eats available food, verifies changes and releases item use", async () => {
    const h = fixture();
    expect(await h.actions.call("eat_food", {})).toMatchObject({ food: 17 });
    expect(h.bot.deactivateItem).toHaveBeenCalled();
    h.bot.food = 20;
    await expect(h.actions.call("eat_food", {})).rejects.toThrow(
      "already full",
    );
    await expect(h.actions.call("eat_food", { item: "stone" })).rejects.toThrow(
      "not food",
    );
  });
  it("sleeps and wakes with verified state; sleep is not accidental bed detonation", async () => {
    const h = fixture();
    h.setBlock("red_bed");
    await h.actions.call("sleep", {});
    expect(h.bot.isSleeping).toBe(true);
    await h.actions.call("wake", {});
    expect(h.bot.isSleeping).toBe(false);
    h.bot.game.dimension = "the_nether";
    await expect(h.actions.call("sleep", {})).rejects.toThrow("Beds explode");
    expect(h.bot.sleep).toHaveBeenCalledTimes(1);
  });
  it("reports Minecraft sleep refusal without exposing arbitrary server text", async () => {
    const h = fixture();
    h.setBlock("red_bed");
    h.bot.sleep.mockRejectedValue(new Error("server-secret"));
    await expect(h.actions.call("sleep", {})).rejects.toThrow(
      "night, unoccupied bed",
    );
  });
  it("sends one targeted melee hit without fabricating damage or a kill", async () => {
    const h = fixture();
    expect(
      await h.actions.call("attack_entity", { entityId: 2 }),
    ).toMatchObject({
      attacksSent: 1,
      summary: expect.stringContaining("damage is not confirmed"),
    });
    expect(h.bot.attack).toHaveBeenCalledExactlyOnceWith(h.target);
    await expect(
      h.actions.call("attack_entity", { entityId: 999 }),
    ).rejects.toThrow("no longer tracked");
  });
  it("fight requires a target death event and cleans up listeners", async () => {
    vi.useFakeTimers();
    const h = fixture();
    h.bot.attack.mockImplementation(() => h.bot.emit("entityDead", h.target));
    const result = h.actions.call("attack_entity", {
      entityId: 2,
      mode: "fight",
    });
    await vi.advanceTimersByTimeAsync(1100);
    expect(await result).toMatchObject({ outcome: "dead", attacksSent: 1 });
    expect(h.bot.listenerCount("entityDead")).toBe(0);
  });
  it("does not hit through a wall and never interprets despawn as a kill", async () => {
    vi.useFakeTimers();
    const h = fixture();
    h.bot.entityAtCursor.mockReturnValue(null);
    const result = h.actions.call("attack_entity", {
      entityId: 2,
      mode: "fight",
      seconds: 1,
    });
    const expected = expect(result).rejects.toThrow("defeat is not confirmed");
    await vi.advanceTimersByTimeAsync(1100);
    await expected;
    expect(h.bot.attack).not.toHaveBeenCalled();
    delete h.bot.entities[2];
    await expect(
      h.actions.call("attack_entity", { entityId: 2 }),
    ).rejects.toThrow("no longer tracked");
  });
  it("stops repeated combat immediately on cancellation", async () => {
    vi.useFakeTimers();
    const h = fixture();
    const result = h.actions.call("attack_entity", {
      entityId: 2,
      mode: "fight",
    });
    const expected = expect(result).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(100);
    h.controller.abort();
    await vi.advanceTimersByTimeAsync(2000);
    await expected;
    expect(h.bot.attack).toHaveBeenCalledTimes(1);
    expect(h.bot.listenerCount("entityDead")).toBe(0);
  });
  it("interacts with entities and verifies mount/dismount", async () => {
    const h = fixture();
    await h.actions.call("interact_entity", { action: "mount", entityId: 2 });
    expect(h.bot.vehicle).toBe(h.target);
    await h.actions.call("interact_entity", { action: "dismount" });
    expect(h.bot.vehicle).toBeNull();
    expect(
      await h.actions.call("interact_entity", {
        action: "interact",
        entityId: 2,
      }),
    ).toMatchObject({ summary: expect.stringContaining("not confirmed") });
  });
  it("digs an exact block, respects area and does not require picking up its drop", async () => {
    const h = fixture();
    expect(await h.actions.call("dig_block", { position: p })).toMatchObject({
      summary: expect.stringContaining("block change verified"),
    });
    expect(h.host.area).toHaveBeenCalledWith(new Vec3(3, 64, 0));
    expect(h.bot.dig).toHaveBeenCalledTimes(1);
  });
  it("distinguishes a block interaction request from a verified effect", async () => {
    const h = fixture();
    h.setBlock("lever");
    expect(
      await h.actions.call("interact_block", { position: p }),
    ).toMatchObject({
      block: "lever",
      summary: expect.stringContaining("before assuming"),
    });
    await h.actions.call("look_at", { position: p });
    expect(h.bot.lookAt).toHaveBeenCalled();
  });
  it("releases held item on stop rather than leaving a bow/shield active", async () => {
    vi.useFakeTimers();
    const h = fixture();
    const result = h.actions.call("use_item", { milliseconds: 5000 });
    const expected = expect(result).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(10);
    h.controller.abort();
    await expected;
    expect(h.bot.deactivateItem).toHaveBeenCalledOnce();
  });
  it("shows recipe ingredients and treats crafting count as operations", async () => {
    const h = fixture();
    expect(
      await h.actions.call("get_recipes", { item: "oak_planks" }),
    ).toMatchObject({ recipes: [{ output: 4, craftableWithInventory: true }] });
    expect(
      await h.actions.call("craft_item", { item: "oak_planks", count: 2 }),
    ).toMatchObject({ operations: 2, outputGain: 8 });
    expect(h.bot.craft).toHaveBeenCalledTimes(2);
  });
  function tableCraftFixture() {
    const h = fixture();
    const table = {
      name: "crafting_table",
      stateId: 2,
      position: new Vec3(3, 64, 0),
    };
    const recipe = { requiresTable: true, result: { count: 4 } };
    h.bot.recipesFor.mockImplementation(
      (_id: number, _meta: unknown, _count: number, table: unknown) =>
        table ? [recipe] : [],
    );
    h.bot.blockAt.mockImplementation((p: Vec3) =>
      p.equals(table.position) ? table : { name: "stone", position: p },
    );
    h.bot.findBlocks.mockReturnValue([table.position]);
    return { ...h, table };
  }
  it("rediscovers a real table when a base/floor coordinate is supplied, then approaches before crafting", async () => {
    const h = tableCraftFixture();
    await h.actions.call("craft_item", {
      item: "oak_planks",
      count: 1,
      table: { x: 0, y: 63, z: 0 },
    });
    expect(h.host.approachBlock).toHaveBeenCalledWith(
      h.table.position,
      h.controller.signal,
    );
    expect(h.host.navigate).not.toHaveBeenCalled();
    expect(h.bot.craft).toHaveBeenCalledWith(expect.anything(), 1, h.table);
    expect(
      vi.mocked(h.host.approachBlock).mock.invocationCallOrder[0],
    ).toBeLessThan(h.bot.craft.mock.invocationCallOrder[0]);
  });
  it("ignores unnecessary stale table hints for inventory-only recipes", async () => {
    const h = fixture();
    await h.actions.call("craft_item", {
      item: "oak_planks",
      count: 1,
      table: p,
    });
    expect(h.host.approachBlock).not.toHaveBeenCalled();
    expect(h.bot.craft).toHaveBeenCalledWith(expect.anything(), 1, undefined);
  });
  it("checks ingredients before walking, and gives an actionable missing-table error", async () => {
    const h = tableCraftFixture();
    h.bot.recipesFor.mockReturnValue([]);
    await expect(
      h.actions.call("craft_item", { item: "oak_planks", count: 1 }),
    ).rejects.toThrow("ingredients");
    expect(h.host.approachBlock).not.toHaveBeenCalled();
    const missing = tableCraftFixture();
    missing.bot.findBlocks.mockReturnValue([]);
    await expect(
      missing.actions.call("craft_item", { item: "oak_planks", count: 1 }),
    ).rejects.toThrow("No loaded crafting table");
    expect(missing.bot.craft).not.toHaveBeenCalled();
  });
  it("tries another discovered station only on a navigation failure before crafting", async () => {
    const h = tableCraftFixture();
    const other = { ...h.table, position: new Vec3(8, 64, 0) };
    h.bot.findBlocks.mockReturnValue([h.table.position, other.position]);
    h.bot.blockAt.mockImplementation((p: Vec3) =>
      p.equals(other.position) ? other : h.table,
    );
    vi.mocked(h.host.approachBlock).mockRejectedValueOnce(
      Object.assign(new Error("unreachable"), { name: "NoPath" }),
    );
    await h.actions.call("craft_item", { item: "oak_planks", count: 1 });
    expect(h.bot.craft).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      1,
      other,
    );
  });
  it("never crafts at a replaced table and does not retry uncertain inventory operations", async () => {
    const h = tableCraftFixture();
    vi.mocked(h.host.approachBlock).mockImplementation(async () => {
      h.table.name = "stone";
    });
    await expect(
      h.actions.call("craft_item", { item: "oak_planks", count: 1 }),
    ).rejects.toThrow("No reachable crafting table");
    expect(h.bot.craft).not.toHaveBeenCalled();
    const failed = tableCraftFixture();
    failed.bot.craft.mockRejectedValue(new Error("server failure"));
    await expect(
      failed.actions.call("craft_item", { item: "oak_planks", count: 2 }),
    ).rejects.toThrow("no automatic retry");
    expect(failed.bot.craft).toHaveBeenCalledOnce();
  });
  it("does not dispatch crafting after cancellation during navigation", async () => {
    const h = tableCraftFixture();
    vi.mocked(h.host.approachBlock).mockImplementation(async () => {
      h.controller.abort();
    });
    await expect(
      h.actions.call("craft_item", { item: "oak_planks", count: 1 }),
    ).rejects.toThrow();
    expect(h.bot.craft).not.toHaveBeenCalled();
  });
  it("inspects/deposits/withdraws using the active window's inventory and closes it", async () => {
    const h = fixture();
    h.setBlock("chest");
    await h.actions.call("container", {
      position: p,
      action: "deposit",
      item: "stone",
      count: 3,
    });
    expect(h.slots[9].count).toBe(9);
    await h.actions.call("container", {
      position: p,
      action: "withdraw",
      item: "stone",
      count: 2,
    });
    expect(h.slots[9].count).toBe(11);
    expect(
      await h.actions.call("container", { position: p, action: "inspect" }),
    ).toHaveProperty("items");
    expect(h.bot.currentWindow).toBeNull();
    expect(h.window.close).toHaveBeenCalledTimes(3);
  });
  it("closes storage on failed transfers and requires explicit transfer quantities", async () => {
    const h = fixture();
    h.setBlock("barrel");
    await expect(
      h.actions.call("container", { position: p, action: "withdraw" }),
    ).rejects.toThrow("item and count");
    h.window.deposit.mockRejectedValue(new Error("secret"));
    await expect(
      h.actions.call("container", {
        position: p,
        action: "deposit",
        item: "stone",
        count: 1,
      }),
    ).rejects.toThrow("not confirmed");
    expect(h.bot.currentWindow).toBeNull();
  });
  it("inserts furnace fuel/input and retrieves output without claiming smelting is complete", async () => {
    const h = fixture();
    h.setBlock("furnace");
    await h.actions.call("furnace", {
      position: p,
      action: "put_input",
      item: "stone",
      count: 3,
    });
    await h.actions.call("furnace", {
      position: p,
      action: "put_fuel",
      item: "coal",
      count: 2,
    });
    expect(
      await h.actions.call("furnace", { position: p, action: "take_output" }),
    ).toMatchObject({
      summary: expect.stringContaining("smelting completion is separate"),
    });
    expect(h.slots[12].count).toBe(2);
    expect(h.bot.currentWindow).toBeNull();
  });
  it("cleans up a window that opens after cancellation", async () => {
    const h = fixture();
    h.setBlock("chest");
    let resolve!: (w: any) => void;
    h.open.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const result = h.actions.call("container", {
      position: p,
      action: "inspect",
    });
    const expected = expect(result).rejects.toThrow();
    await vi.waitFor(() => expect(h.open).toHaveBeenCalled());
    h.controller.abort();
    await expected;
    h.bot.currentWindow = h.window;
    resolve(h.window);
    await vi.waitFor(() => expect(h.bot.currentWindow).toBeNull());
  });
  it("fences timed-out inventory operations until upstream settles", async () => {
    vi.useFakeTimers();
    const h = fixture();
    let resolve!: () => void;
    h.bot.toss.mockImplementation(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    const result = h.actions.call("drop_items", { item: "stone", count: 1 });
    const expected = expect(result).rejects.toThrow("did not finish in time");
    await vi.advanceTimersByTimeAsync(10100);
    await expected;
    const idle = h.actions.idle(new AbortController().signal);
    const notSettled = expect(idle).rejects.toThrow("has not settled");
    await vi.advanceTimersByTimeAsync(10100);
    await notSettled;
    resolve();
    await vi.advanceTimersByTimeAsync(1);
    await expect(
      h.actions.idle(new AbortController().signal),
    ).resolves.toBeUndefined();
  });
  it("rejects invalid/unbounded arguments before any item/world effect", async () => {
    const h = fixture();
    for (const count of [-1, 0, 1025])
      await expect(
        h.actions.call("drop_items", { item: "stone", count }),
      ).rejects.toThrow();
    await expect(
      h.actions.call("attack_entity", { entityId: -1 }),
    ).rejects.toThrow();
    await expect(
      h.actions.call("dig_block", { position: { ...p, x: NaN } }),
    ).rejects.toThrow();
    expect(h.bot.toss).not.toHaveBeenCalled();
    expect(h.bot.attack).not.toHaveBeenCalled();
    expect(h.bot.dig).not.toHaveBeenCalled();
  });
});
