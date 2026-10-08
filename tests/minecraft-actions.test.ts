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
    diagnostic: vi.fn(),
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
  it("can equip for combat, retreat on low health, and rejects reused target IDs", async () => {
    const h = fixture();
    h.add("diamond_sword", 1, 12);
    h.bot.health = 4;
    await expect(
      h.actions.call("attack_entity", {
        entityId: 2,
        mode: "fight",
        equipBest: true,
        retreatHealth: 6,
        retreatTo: p,
      }),
    ).rejects.toThrow("Retreated");
    expect(h.bot.heldItem.name).toBe("diamond_sword");
    expect(h.host.navigate).toHaveBeenCalled();
    expect(h.bot.attack).not.toHaveBeenCalled();
    await expect(
      h.actions.call("attack_entity", {
        entityId: 2,
        entityUuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
    ).rejects.toThrow("identity changed");
    expect(h.bot.attack).not.toHaveBeenCalled();
  });
  it("inspects enchanting offers, returns the item, and verifies changed enchantment metadata", async () => {
    const h = fixture();
    h.setBlock("enchanting_table");
    h.bot.experience = { level: 30 };
    const sword = h.add("iron_sword", 1, 12);
    h.add("lapis_lazuli", 8, 13);
    let target: any = null;
    const items: any[] = [sword, h.slots[13]];
    const w: any = {
      inventoryStart: 2,
      slots: Array(38).fill(null),
      enchantments: [
        { level: 5, expected: {} },
        { level: 15, expected: {} },
        { level: 30, expected: {} },
      ],
      items: () => items,
      putTargetItem: vi.fn(async (item) => {
        target = item;
        items.splice(items.indexOf(item), 1);
      }),
      targetItem: () => target,
      takeTargetItem: vi.fn(async () => {
        items.push(target);
        target = null;
      }),
      putLapis: vi.fn(async () => {}),
      enchant: vi.fn(async () => {
        target = { ...target, enchants: [{ name: "sharpness", lvl: 2 }] };
      }),
      close: vi.fn(async () => {
        h.bot.currentWindow = null;
      }),
    };
    h.bot.openEnchantmentTable = vi.fn(async () => {
      w.slots[5] = sword;
      h.bot.currentWindow = w;
      return w;
    });
    expect(
      await h.actions.call("enchant_item", {
        position: p,
        item: "iron_sword",
        action: "inspect",
      }),
    ).toMatchObject({
      offers: [
        { requiredLevel: 5 },
        { requiredLevel: 15 },
        { requiredLevel: 30 },
      ],
    });
    expect(w.enchant).not.toHaveBeenCalled();
    expect(
      await h.actions.call("enchant_item", {
        position: p,
        item: "iron_sword",
        action: "enchant",
        choice: 2,
      }),
    ).toMatchObject({ item: { enchants: [{ name: "sharpness", lvl: 2 }] } });
    expect(w.close).toHaveBeenCalledTimes(2);
    h.bot.experience.level = 0;
    await expect(
      h.actions.call("enchant_item", {
        position: p,
        item: "iron_sword",
        action: "enchant",
        choice: 1,
      }),
    ).rejects.toThrow("Requires experience level");
    expect(w.close).toHaveBeenCalledTimes(3);
    expect(w.enchant).toHaveBeenCalledTimes(1);
  });
  it("previews server anvil output, verifies returned metadata and closes on uncertain apply", async () => {
    const h = fixture();
    h.setBlock("anvil");
    h.bot.experience = { level: 10 };
    const sword = h.add("iron_sword", 1, 12);
    const result = { ...sword, customName: "Eva's blade" };
    const items: any[] = [];
    const w = {
      id: 42,
      inventoryStart: 3,
      slots: [null, null, result] as any[],
      items: () => items,
      close: vi.fn(async () => {
        h.bot.currentWindow = null;
      }),
    };
    h.bot._client = new EventEmitter();
    h.bot._client.write = vi.fn(() => {
      h.bot._client.emit("craft_progress_bar", {
        windowId: 42,
        property: 0,
        value: 1,
      });
    });
    h.bot.moveSlotItem = vi.fn(async () => {
      w.slots[0] = sword;
    });
    h.bot.putAway = vi.fn(async (slot) => {
      if (slot === 0) w.slots[0] = null;
      else items.push(result);
    });
    h.bot.openAnvil = vi.fn(async () => {
      h.bot.currentWindow = w;
      return w;
    });
    const args = {
      position: p,
      first: 12,
      name: "Eva's blade",
      action: "inspect",
    };
    expect(await h.actions.call("anvil_item", args)).toMatchObject({
      levels: 1,
      item: { customName: "Eva's blade" },
    });
    expect(h.bot.putAway).not.toHaveBeenCalledWith(2);
    expect(h.bot.putAway).toHaveBeenCalledWith(0);
    expect(
      await h.actions.call("anvil_item", { ...args, action: "apply" }),
    ).toMatchObject({ item: { customName: "Eva's blade" } });
    expect(w.close).toHaveBeenCalledTimes(2);
    h.bot.putAway.mockResolvedValue(undefined);
    await expect(
      h.actions.call("anvil_item", { ...args, action: "apply" }),
    ).rejects.toThrow("Expected world change");
    expect(h.bot.putAway).toHaveBeenCalledTimes(3);
    expect(w.close).toHaveBeenCalledTimes(3);
    expect(h.bot._client.listenerCount("craft_progress_bar")).toBe(0);
    expect(h.bot.moveSlotItem).toHaveBeenCalledWith(6, 0);
  });
  it("fishes automatically and verifies collected output before another cast", async () => {
    const h = fixture();
    h.setBlock("water");
    h.add("fishing_rod", 1, 12);
    let catches = 0;
    h.bot.fish = vi.fn(async () => {
      h.add("cod", ++catches, 13);
    });
    expect(await h.actions.call("fish", { catches: 2 })).toMatchObject({
      gains: { cod: 2 },
    });
    expect(h.bot.fish).toHaveBeenCalledTimes(2);
    expect(h.bot.activateItem).not.toHaveBeenCalled();
    h.bot.fish.mockResolvedValue(undefined);
    await expect(h.actions.call("fish", { catches: 3 })).rejects.toThrow(
      "no collected inventory gain",
    );
    expect(h.bot.fish).toHaveBeenCalledTimes(3);
  });
  it("reels once on fishing cancellation, retaining the pending-operation fence", async () => {
    vi.useFakeTimers();
    const h = fixture();
    h.setBlock("water");
    h.add("fishing_rod", 1, 12);
    let rejectFish!: (e: Error) => void;
    h.bot.fish = vi.fn(
      () =>
        new Promise((_r, reject) => {
          rejectFish = reject;
        }),
    );
    const work = h.actions.call("fish", {});
    const assertion = expect(work).rejects.toThrow("Stop fishing");
    await vi.advanceTimersByTimeAsync(10);
    h.controller.abort(new Error("Stop fishing"));
    await assertion;
    expect(h.bot.activateItem).toHaveBeenCalledTimes(1);
    const wait = h.actions.idle(new AbortController().signal);
    const fenced = expect(wait).rejects.toThrow("has not settled");
    await vi.advanceTimersByTimeAsync(10100);
    await fenced;
    rejectFish(new Error("Bobber destroyed"));
    await vi.advanceTimersByTimeAsync(1);
    await h.actions.idle(new AbortController().signal);
  });
  it("collects only a newly observed nearby fishing drop, then returns to shore", async () => {
    const h = fixture();
    h.setBlock("water");
    h.add("fishing_rod", 1, 12);
    h.bot.entities[3] = { name: "item", position: new Vec3(0, 64, 0) };
    h.bot.fish = vi.fn(async () => {
      h.bot.entities[4] = { name: "item", position: new Vec3(2, 64, 0) };
    });
    vi.mocked(h.host.navigate).mockImplementation(async () => {
      h.add("cod", 1, 13);
    });
    expect(await h.actions.call("fish", {})).toMatchObject({
      gains: { cod: 1 },
    });
    expect(h.host.navigate).toHaveBeenNthCalledWith(
      1,
      new Vec3(2, 64, 0),
      h.controller.signal,
      1,
    );
    expect(h.host.navigate).toHaveBeenNthCalledWith(
      2,
      new Vec3(0, 64, 0),
      h.controller.signal,
      1,
    );
  });
  it("neutralizes vehicle steering on completion, dismount, and cancellation", async () => {
    vi.useFakeTimers();
    const h = fixture();
    h.bot.vehicle = h.target;
    h.bot.moveVehicle = vi.fn((_left, forward) => {
      h.target.position.x += forward;
    });
    const work = h.actions.call("steer_vehicle", {
      left: 0,
      forward: 1,
      milliseconds: 200,
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(await work).toMatchObject({ displacement: expect.any(Number) });
    expect(h.target.position.x).toBeGreaterThan(1);
    expect(h.bot.moveVehicle).toHaveBeenLastCalledWith(0, 0);
    const stopped = h.actions.call("steer_vehicle", {
      left: 1,
      forward: 0,
      milliseconds: 5000,
    });
    const assertion = expect(stopped).rejects.toThrow(/Stop steering|aborted/);
    await vi.advanceTimersByTimeAsync(10);
    h.controller.abort(new Error("Stop steering"));
    await assertion;
    expect(h.bot.moveVehicle).toHaveBeenLastCalledWith(0, 0);
  });
  it("never reports stationary steering as movement", async () => {
    vi.useFakeTimers();
    const h = fixture();
    h.bot.vehicle = h.target;
    h.bot.moveVehicle = vi.fn();
    const result = h.actions.call("steer_vehicle", {
      left: 0,
      forward: 1,
      milliseconds: 100,
    });
    const assertion = expect(result).rejects.toThrow(
      "no vehicle movement observed",
    );
    await vi.advanceTimersByTimeAsync(150);
    await assertion;
  });
  it("inspects and trades at fresh prices, verifying each operation and closing windows", async () => {
    const h = fixture();
    h.target.name = "villager";
    let output = 0;
    const w = {
      trades: [
        {
          inputItem1: { name: "emerald", count: 2 },
          realPrice: 3,
          outputItem: { name: "bread", count: 4 },
          nbTradeUses: 0,
          maximumNbTradeUses: 10,
        },
      ],
      items: () => [{ name: "bread", count: output }],
      close: vi.fn(async () => {
        h.bot.currentWindow = null;
      }),
    };
    h.bot.openVillager = vi.fn(async () => {
      h.bot.currentWindow = w;
      return w;
    });
    h.bot.trade = vi.fn(async () => {
      output += 4;
    });
    expect(
      await h.actions.call("trade_villager", {
        entityId: 2,
        action: "inspect",
      }),
    ).toMatchObject({ offers: [{ input1: { count: 3 } }] });
    const args = {
      entityId: 2,
      action: "trade",
      index: 0,
      item: "bread",
      input1: "emerald",
      input2: null,
      count: 2,
      price1: 3,
      price2: 0,
    };
    expect(await h.actions.call("trade_villager", args)).toMatchObject({
      outputGain: 8,
    });
    expect(h.bot.trade).toHaveBeenCalledTimes(2);
    await expect(
      h.actions.call("trade_villager", { ...args, price1: 2 }),
    ).rejects.toThrow("Offer unavailable or changed");
    expect(h.bot.trade).toHaveBeenCalledTimes(2);
    h.bot.trade.mockResolvedValue(undefined);
    await expect(h.actions.call("trade_villager", args)).rejects.toThrow(
      "Expected world change",
    );
    expect(h.bot.trade).toHaveBeenCalledTimes(3);
    expect(w.close).toHaveBeenCalledTimes(4);
    expect(h.bot.currentWindow).toBeNull();
  });
  it("registers all 32 tools with host-valid schemas and entity-aware observation", () => {
    expect(minecraftTools).toHaveLength(32);
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
  it.each([0, 1, 3])(
    "rejects incomplete recipe output (%s of 4), without sending another craft",
    async (gain) => {
      const h = fixture();
      h.bot.craft.mockImplementation(async () => {
        h.add("oak_planks", gain, 13);
      });
      await expect(
        h.actions.call("craft_item", { item: "oak_planks", count: 2 }),
      ).rejects.toThrow(
        `expected 4 oak_planks from this operation, observed gain ${gain}`,
      );
      expect(h.bot.craft).toHaveBeenCalledOnce();
      expect(h.host.progress).not.toHaveBeenCalled();
    },
  );
  it("keeps verified earlier output when a later craft produces nothing", async () => {
    const h = fixture();
    h.bot.craft
      .mockImplementationOnce(async () => {
        h.add("oak_planks", 4, 13);
      })
      .mockImplementationOnce(async () => {});
    await expect(
      h.actions.call("craft_item", { item: "oak_planks", count: 3 }),
    ).rejects.toThrow("verified 1/3 operations");
    expect(h.bot.craft).toHaveBeenCalledTimes(2);
    expect(h.slots[13].count).toBe(4);
    expect(h.host.progress).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("output verified"),
      1,
    );
  });
  it("waits for server inventory synchronization and rejects rolled-back optimistic output", async () => {
    const h = fixture();
    h.bot.supportFeature = () => true;
    h.bot._syncWindow = vi
      .fn(async () => {})
      .mockImplementationOnce(async () => {})
      .mockImplementationOnce(async () => {
        h.slots[13] = null;
      });
    await expect(
      h.actions.call("craft_item", { item: "oak_planks", count: 2 }),
    ).rejects.toThrow("observed gain 0");
    expect(h.bot._syncWindow).toHaveBeenCalledTimes(2);
    expect(h.bot.craft).toHaveBeenCalledOnce();
    expect(h.host.progress).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    "synchronizes each crafting click and restores the original handler (failure=%s)",
    async (fail) => {
      const h = fixture();
      const events: string[] = [];
      h.bot.supportFeature = () => true;
      const click = (h.bot.clickWindow = vi.fn(async () => {
        events.push("click");
      }));
      h.bot._syncWindow = vi.fn(async () => {
        events.push("sync");
      });
      h.bot.craft.mockImplementation(async () => {
        await h.bot.clickWindow(9, 0, 0);
        expect(events).toEqual(["sync", "click", "sync"]);
        if (fail) throw new Error("Rejected");
        h.add("oak_planks", 4, 13);
      });
      const work = h.actions.call("craft_item", {
        item: "oak_planks",
        count: 1,
      });
      if (fail)
        await expect(work).rejects.toThrow("Crafting was not confirmed");
      else await expect(work).resolves.toMatchObject({ outputGain: 4 });
      expect(h.bot.clickWindow).toBe(click);
      expect(h.bot.craft).toHaveBeenCalledOnce();
    },
  );
  it("refuses modern crafting without a server synchronization barrier before changing inventory", async () => {
    const h = fixture();
    h.bot.supportFeature = () => true;
    await expect(
      h.actions.call("craft_item", { item: "oak_planks", count: 1 }),
    ).rejects.toThrow("cannot confirm inventory state");
    expect(h.bot.craft).not.toHaveBeenCalled();
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
    ).rejects.toThrow("No usable table approach");
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
    expect(
      vi.mocked(h.host.diagnostic).mock.calls.map(([d]) => d.outcome),
    ).toEqual(["approaching"]);
  });
  it("retains all three table coordinates and distinguishes path failure, search timeout and failed arrival", async () => {
    const h = tableCraftFixture();
    const positions = [
      new Vec3(3, 64, 0),
      new Vec3(4, 64, 0),
      new Vec3(5, 64, 0),
    ];
    h.bot.findBlocks.mockReturnValue(positions);
    h.bot.blockAt.mockImplementation((p: Vec3) => ({
      ...h.table,
      position: p,
    }));
    for (const name of ["NoPath", "Timeout", "InteractionBlocked"])
      vi.mocked(h.host.approachBlock).mockRejectedValueOnce(
        Object.assign(new Error("untrusted server content"), { name }),
      );
    await expect(
      h.actions.call("craft_item", { item: "oak_planks", count: 1 }),
    ).rejects.toThrow("3 checked");
    const entries = vi
      .mocked(h.host.diagnostic)
      .mock.calls.map(([d]) => d)
      .filter((d) => d.outcome !== "approaching");
    expect(entries.map((d) => d.outcome)).toEqual([
      "no_path",
      "search_timeout",
      "interaction_blocked",
    ]);
    expect(entries.map((d) => d.position.x)).toEqual([3, 4, 5]);
    expect(entries.every((d) => d.elapsedMs >= 0)).toBe(true);
    expect(JSON.stringify(entries)).not.toContain("untrusted");
    expect(h.bot.craft).not.toHaveBeenCalled();
  });
  it("preserves an earlier table failure when a later table succeeds", async () => {
    const h = tableCraftFixture();
    h.bot.findBlocks.mockReturnValue([new Vec3(3, 64, 0), new Vec3(4, 64, 0)]);
    h.bot.blockAt.mockImplementation((p: Vec3) => ({
      ...h.table,
      position: p,
    }));
    vi.mocked(h.host.approachBlock).mockRejectedValueOnce(
      Object.assign(new Error("Timeout"), { name: "Timeout" }),
    );
    await h.actions.call("craft_item", { item: "oak_planks", count: 1 });
    expect(
      vi.mocked(h.host.diagnostic).mock.calls.map(([d]) => d.outcome),
    ).toEqual(["approaching", "search_timeout", "approaching", "reached"]);
    expect(h.bot.craft).toHaveBeenCalledOnce();
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
