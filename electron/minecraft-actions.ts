import { setTimeout as delay } from "node:timers/promises";
import { Vec3 } from "vec3";
import { goals } from "mineflayer-pathfinder";
import type { Bot, EquipmentDestination } from "mineflayer";
import { z } from "zod";
import { pointSchema, type MinecraftJob } from "../src/shared/minecraft";
import { minecraftGameplayTools } from "../src/shared/minecraft-gameplay";
import { MinecraftActionError as ActionError } from "./minecraft-action-error";

type Result = Record<string, unknown>;
export interface GameplayHost {
  start(
    kind: MinecraftJob["kind"],
    work: (signal: AbortSignal) => Promise<Result>,
    movement: boolean,
  ): unknown;
  check(signal: AbortSignal): void;
  navigate(point: Vec3, signal: AbortSignal, distance?: number): Promise<void>;
  area(point: Vec3): void;
  until(
    test: () => boolean,
    signal: AbortSignal,
    milliseconds?: number,
  ): Promise<void>;
  progress(detail: string, count?: number): void;
}
const itemName = z.string().regex(/^[a-z0-9_]{1,100}$/);
const blockPoint = pointSchema.extend({
  x: z.number().int().min(-30000000).max(30000000),
  y: z.number().int().min(-2048).max(2048),
  z: z.number().int().min(-30000000).max(30000000),
});
const quantity = z.number().int().min(1).max(1024);
const idSchema = z.number().int().nonnegative();
const destinations = { head: 5, torso: 6, legs: 7, feet: 8, "off-hand": 45 };
const point = (p: { x: number; y: number; z: number }) =>
  new Vec3(p.x, p.y, p.z);
const summaryItem = (i: Bot["heldItem"] | undefined) =>
  i
    ? {
        name: i.name.slice(0, 100),
        count: i.count,
        slot: i.slot,
        durabilityUsed: i.durabilityUsed,
      }
    : null;

/** New gameplay stays behind the engine's one-action owner. Every awaited
 * protocol operation is bounded; timed-out operations retain a settling fence
 * until upstream actually returns, so a replacement cannot race inventory I/O.
 */
export class MinecraftActions {
  private pending = new Set<Promise<unknown>>();
  constructor(
    private bot: Bot,
    private host: GameplayHost,
  ) {}
  handles(name: string) {
    return minecraftGameplayTools.some((t) => t.name === name);
  }
  async idle(signal: AbortSignal) {
    const end = Date.now() + 10000;
    while (this.pending.size) {
      this.host.check(signal);
      if (Date.now() > end)
        throw new ActionError(
          "The previous inventory/world operation has not settled. Reconnect Eva before another action; its result may be partial.",
        );
      await delay(50, undefined, { signal });
    }
  }
  private async step<T>(
    operation: () => Promise<T>,
    signal: AbortSignal,
    label: string,
    ms = 10000,
    lateCleanup?: (value: T) => Promise<void>,
  ): Promise<T> {
    this.host.check(signal);
    let expired = false;
    const pending = Promise.resolve()
      .then(() => {
        this.host.check(signal);
        return operation();
      })
      .then(async (value) => {
        if (expired || signal.aborted) {
          await lateCleanup?.(value);
          signal.throwIfAborted();
          throw new ActionError(
            "Operation finished after its timeout; inspect state before retrying.",
          );
        }
        return value;
      });
    this.pending.add(pending);
    void pending.then(
      () => this.pending.delete(pending),
      () => this.pending.delete(pending),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    let aborted = () => {};
    try {
      const result = await Promise.race([
        pending,
        new Promise<never>((_, reject) => {
          aborted = () => reject(signal.reason ?? new Error("Cancelled"));
          signal.addEventListener("abort", aborted, { once: true });
          if (signal.aborted) aborted();
          timer = setTimeout(
            () =>
              reject(
                new ActionError(
                  `${label} did not finish in time. Inspect the world/inventory before retrying; the result may be partial.`,
                ),
              ),
            ms,
          );
        }),
      ]);
      this.host.check(signal);
      return result;
    } catch (error) {
      expired = true;
      signal.throwIfAborted();
      if (error instanceof ActionError) throw error;
      // Do not forward untrusted server/window text to the companion prompt.
      throw new ActionError(
        `${label} was not confirmed by Minecraft. Check reach, inventory space and game conditions; no automatic retry.`,
      );
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", aborted);
    }
  }
  private inventoryCount(name: string) {
    return this.bot.inventory
      .items()
      .filter((i) => i.name === name)
      .reduce((n, i) => n + i.count, 0);
  }
  private inventoryItem(name: string, slot?: number) {
    const item = this.bot.inventory
      .items()
      .find((i) => i.name === name && (slot === undefined || i.slot === slot));
    if (!item)
      throw new ActionError(
        `No ${name} in ${slot === undefined ? "inventory" : `slot ${slot}`}.`,
      );
    return item;
  }
  private blockAt(p: Vec3) {
    const block = this.bot.blockAt(p);
    if (!block)
      throw new ActionError("That block is not loaded; move closer first.");
    return block;
  }
  private entity(id: number) {
    const entity = this.bot.entities[id];
    if (!entity || entity === this.bot.entity || entity.isValid === false)
      throw new ActionError(
        "That entity is no longer tracked. Observe again to select a current target.",
      );
    return entity;
  }
  private vehicle() {
    return (this.bot as Bot & { vehicle?: Bot["entity"] }).vehicle;
  }
  private async approachBlock(p: Vec3, signal: AbortSignal) {
    await this.host.navigate(p, signal, 2);
    this.host.check(signal);
    const block = this.blockAt(p);
    if (
      this.bot.entity.position.distanceTo(p) > 4.5 ||
      !this.bot.canSeeBlock(block)
    )
      throw new ActionError(
        "The block is out of reach or behind another block.",
      );
    return block;
  }
  private start(
    kind: MinecraftJob["kind"],
    work: (signal: AbortSignal) => Promise<Result>,
    movement = false,
  ) {
    return this.host.start(
      kind,
      async (signal) => {
        await this.idle(signal);
        this.host.check(signal);
        return work(signal);
      },
      movement,
    );
  }
  async call(name: string, raw: unknown): Promise<unknown> {
    if (name === "inspect_inventory") {
      z.object({}).strict().parse(raw);
      return {
        items: this.bot.inventory.items().slice(0, 46).map(summaryItem),
        held: summaryItem(this.bot.heldItem),
        equipment: Object.fromEntries(
          Object.entries(destinations).map(([name, slot]) => [
            name,
            summaryItem(this.bot.inventory.slots[slot]),
          ]),
        ),
        food: this.bot.food,
        health: this.bot.health,
        sleeping: this.bot.isSleeping,
      };
    }
    if (name === "find_blocks") {
      const a = z
        .object({
          block: itemName,
          radius: z.number().int().min(1).max(128).default(32),
          limit: z.number().int().min(1).max(32).default(16),
        })
        .strict()
        .parse(raw);
      const block = this.bot.registry.blocksByName[a.block];
      if (!block) throw new ActionError("Unknown block ID.");
      return {
        block: a.block,
        loadedChunksOnly: true,
        positions: this.bot
          .findBlocks({
            matching: block.id,
            maxDistance: a.radius,
            count: a.limit,
          })
          .sort(
            (a, b) =>
              a.distanceTo(this.bot.entity.position) -
              b.distanceTo(this.bot.entity.position),
          ),
      };
    }
    if (name === "drop_items") {
      const a = z
        .object({
          item: itemName,
          count: quantity,
          slot: z.number().int().min(0).max(45).optional(),
        })
        .strict()
        .parse(raw);
      return this.start("drop", async (signal) => {
        const item = this.inventoryItem(a.item, a.slot),
          before = this.inventoryCount(a.item);
        if ((a.slot === undefined ? before : item.count) < a.count)
          throw new ActionError(
            "Not enough items in the selected inventory/stack.",
          );
        if (this.bot.currentWindow)
          throw new ActionError(
            "Close the current inventory window before dropping items.",
          );
        if (a.slot === undefined)
          await this.step(
            () => this.bot.toss(item.type, item.metadata, a.count),
            signal,
            "Dropping items",
          );
        else
          await this.step(
            () =>
              this.bot.transfer({
                window: this.bot.inventory,
                itemType: item.type,
                metadata: item.metadata,
                count: a.count,
                sourceStart: item.slot,
                sourceEnd: item.slot + 1,
                destStart: -999,
                destEnd: -999,
              }),
            signal,
            "Dropping the selected stack",
          );
        await this.host.until(
          () => this.inventoryCount(a.item) <= before - a.count,
          signal,
        );
        return {
          summary: `Dropped ${a.count} ${a.item}; inventory decrease verified. Recipient pickup is not verified.`,
          item: a.item,
          count: a.count,
        };
      });
    }
    if (name === "equip_item") {
      const a = z
        .object({
          item: itemName.nullable(),
          destination: z.enum([
            "hand",
            "off-hand",
            "head",
            "torso",
            "legs",
            "feet",
          ]),
          slot: z.number().int().min(0).max(45).optional(),
        })
        .strict()
        .parse(raw);
      return this.start("equip", async (signal) => {
        const equipped = () =>
          a.destination === "hand"
            ? this.bot.heldItem
            : this.bot.inventory.slots[destinations[a.destination]];
        if (a.item === null) {
          // Mineflayer's unequip(hand) can toss the held stack when full.
          // Unequipping is not permission to invoke the drop-items tool indirectly.
          if (
            equipped() &&
            !this.bot.inventory.slots.slice(9, 45).some((i) => i === null)
          )
            throw new ActionError(
              "Inventory is full. Make an empty slot before unequipping; nothing was dropped.",
            );
          await this.step(
            () => this.bot.unequip(a.destination),
            signal,
            "Unequipping",
          );
        } else {
          const item = this.inventoryItem(a.item, a.slot);
          await this.step(
            () => this.bot.equip(item, a.destination as EquipmentDestination),
            signal,
            "Equipping",
          );
        }
        await this.host.until(
          () => (equipped()?.name ?? null) === a.item,
          signal,
        );
        return {
          summary: a.item
            ? `Equipped ${a.item} in ${a.destination}.`
            : `Unequipped ${a.destination}.`,
          equipped: summaryItem(equipped()),
        };
      });
    }
    if (name === "eat_food") {
      const a = z.object({ item: itemName.optional() }).strict().parse(raw);
      return this.start("eat", async (signal) => {
        const food = a.item
          ? this.inventoryItem(a.item)
          : this.bot.inventory
              .items()
              .filter((i) => this.bot.registry.foodsByName[i.name])
              .sort(
                (a, b) =>
                  this.bot.registry.foodsByName[b.name].foodPoints -
                  this.bot.registry.foodsByName[a.name].foodPoints,
              )[0];
        if (!food) throw new ActionError("No food in inventory.");
        if (
          !this.bot.registry.foodsByName[food.name] &&
          !["potion", "milk_bucket"].includes(food.name)
        )
          throw new ActionError("The selected item is not food or a drink.");
        if (
          this.bot.food >= 20 &&
          ![
            "potion",
            "milk_bucket",
            "golden_apple",
            "enchanted_golden_apple",
          ].includes(food.name)
        )
          throw new ActionError("Hunger is already full.");
        const before = this.inventoryCount(food.name),
          hunger = this.bot.food;
        await this.step(
          () => this.bot.equip(food, "hand"),
          signal,
          "Holding food",
        );
        try {
          await this.step(
            () => this.bot.consume(),
            signal,
            "Eating/drinking",
            5000,
          );
        } finally {
          this.bot.deactivateItem();
        }
        await this.host.until(
          () =>
            this.inventoryCount(food.name) < before || this.bot.food > hunger,
          signal,
        );
        return {
          summary: `Consumed ${food.name}; inventory or hunger change verified.`,
          food: this.bot.food,
        };
      });
    }
    if (name === "sleep") {
      const a = z
        .object({ position: blockPoint.optional() })
        .strict()
        .parse(raw);
      return this.start(
        "sleep",
        async (signal) => {
          if (this.bot.isSleeping) return { summary: "Already sleeping." };
          if (this.bot.game.dimension !== "overworld")
            throw new ActionError(
              "Beds explode in this dimension; use interact_block if you intend that, not sleep.",
            );
          const position = a.position
            ? point(a.position)
            : this.bot.findBlock({
                matching: (b) => this.bot.isABed(b),
                maxDistance: 32,
              })?.position;
          if (!position)
            throw new ActionError(
              "No loaded bed nearby. Find or place a bed first.",
            );
          const bed = await this.approachBlock(position, signal);
          if (!this.bot.isABed(bed))
            throw new ActionError("The target is not a bed.");
          await this.step(
            () => this.bot.sleep(bed),
            signal,
            "Sleeping (night, unoccupied bed and no nearby monsters required)",
            5000,
          );
          await this.host.until(() => this.bot.isSleeping, signal);
          return {
            summary: "Sleeping in bed; sleep state confirmed.",
            position,
          };
        },
        true,
      );
    }
    if (name === "wake") {
      z.object({}).strict().parse(raw);
      return this.start("wake", async (signal) => {
        if (this.bot.isSleeping) {
          await this.step(() => this.bot.wake(), signal, "Waking");
          await this.host.until(() => !this.bot.isSleeping, signal);
        }
        return { summary: "Awake; state confirmed." };
      });
    }
    if (
      name === "look_at" ||
      name === "interact_block" ||
      name === "dig_block"
    ) {
      const a = z.object({ position: blockPoint }).strict().parse(raw),
        p = point(a.position);
      return this.start(
        name === "look_at" ? "look" : name === "dig_block" ? "dig" : "interact",
        async (signal) => {
          if (name === "look_at") {
            await this.step(() => this.bot.lookAt(p), signal, "Looking");
            return { summary: "Look direction updated." };
          }
          this.host.area(p);
          const block = await this.approachBlock(p, signal),
            original = block.stateId;
          if (name === "dig_block") {
            if (["air", "cave_air", "void_air"].includes(block.name))
              return { summary: "There is already no block at that position." };
            if (!this.bot.canDigBlock(block))
              throw new ActionError("That block cannot be dug from here.");
            await this.step(
              () => this.bot.dig(block),
              signal,
              "Digging",
              Math.min(120000, Math.max(10000, this.bot.digTime(block) + 5000)),
            );
            await this.host.until(() => {
              const current = this.bot.blockAt(p);
              return !!current && current.stateId !== original;
            }, signal);
            return {
              summary: `Broke ${block.name}; block change verified. Item pickup is not verified.`,
              position: p,
            };
          }
          await this.step(
            () => this.bot.activateBlock(block),
            signal,
            "Block interaction",
          );
          if (this.bot.currentWindow)
            await this.step(
              () => this.bot.closeWindow(this.bot.currentWindow!),
              signal,
              "Closing interaction window",
            );
          return {
            summary:
              "Block interaction sent; inspect the resulting world state before assuming its effect.",
            block: this.blockAt(p).name,
            stateId: this.blockAt(p).stateId,
          };
        },
        name !== "look_at",
      );
    }
    if (name === "use_item") {
      const a = z
        .object({
          aim: blockPoint.optional(),
          milliseconds: z.number().int().min(0).max(5000).default(1000),
        })
        .strict()
        .parse(raw);
      return this.start("use", async (signal) => {
        if (!this.bot.heldItem)
          throw new ActionError("Nothing is held. Equip an item first.");
        if (a.aim) {
          const aim = point(a.aim);
          await this.step(() => this.bot.lookAt(aim), signal, "Aiming");
        }
        this.host.check(signal);
        this.bot.activateItem();
        try {
          await delay(a.milliseconds, undefined, { signal });
        } finally {
          this.bot.deactivateItem();
        }
        return {
          summary:
            "Held-item use and release sent. Projectile hits or other world effects are not confirmed.",
        };
      });
    }
    if (name === "attack_entity") {
      const a = z
        .object({
          entityId: idSchema,
          mode: z.enum(["hit", "fight"]).default("hit"),
          seconds: z.number().int().min(1).max(120).default(30),
        })
        .strict()
        .parse(raw);
      return this.start(
        "combat",
        async (signal) => {
          const target = this.entity(a.entityId);
          let dead = false,
            hits = 0;
          const died = (e: Bot["entity"]) => {
            if (e === target) dead = true;
          };
          this.bot.on("entityDead", died);
          this.bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true);
          const end = Date.now() + a.seconds * 1000;
          try {
            while (Date.now() < end) {
              this.host.check(signal);
              if (dead)
                return {
                  summary: "Target death observed.",
                  entityId: target.id,
                  attacksSent: hits,
                  outcome: "dead",
                };
              if (
                this.bot.entities[target.id] !== target ||
                target.isValid === false
              )
                throw new ActionError(
                  "Target disappeared from tracking; a kill is not confirmed.",
                );
              if (this.bot.entity.position.distanceTo(target.position) <= 3) {
                await this.step(
                  () =>
                    this.bot.lookAt(
                      target.position.offset(
                        0,
                        Math.min(target.height / 2, 1.5),
                        0,
                      ),
                      true,
                    ),
                  signal,
                  "Aiming at target",
                );
                if (this.bot.entityAtCursor(3)?.id === target.id) {
                  this.host.check(signal);
                  this.bot.attack(target);
                  hits++;
                  this.host.progress(
                    `Fighting ${target.name ?? target.username ?? "target"}; ${hits} attacks sent.`,
                    hits,
                  );
                  if (a.mode === "hit")
                    return {
                      summary:
                        "One melee attack sent; damage is not confirmed.",
                      attacksSent: 1,
                      entityId: target.id,
                    };
                  // At most one hit/second; axes also have time to recharge.
                  await delay(1000, undefined, { signal });
                  continue;
                }
              }
              await delay(100, undefined, { signal });
            }
            if (dead)
              return {
                summary: "Target death observed.",
                outcome: "dead",
                attacksSent: hits,
              };
            throw new ActionError(
              `Combat time elapsed after ${hits} attacks; target defeat is not confirmed.`,
            );
          } finally {
            this.bot.removeListener("entityDead", died);
          }
        },
        true,
      );
    }
    if (name === "interact_entity") {
      const a = z
        .object({
          action: z.enum(["interact", "mount", "dismount"]),
          entityId: idSchema.optional(),
        })
        .strict()
        .parse(raw);
      if (a.action !== "dismount" && a.entityId === undefined)
        throw new ActionError("Select an observed entity ID.");
      return this.start(
        "interact",
        async (signal) => {
          if (a.action === "dismount") {
            if (this.vehicle()) {
              this.bot.dismount();
              await this.host.until(() => !this.vehicle(), signal);
            }
            return { summary: "Dismounted; state confirmed." };
          }
          const target = this.entity(a.entityId!);
          await this.host.navigate(target.position, signal, 2);
          if (
            this.entity(a.entityId!) !== target ||
            target.position.distanceTo(this.bot.entity.position) > 3
          )
            throw new ActionError(
              "The entity moved out of reach. Observe again.",
            );
          await this.step(
            () =>
              this.bot.lookAt(
                target.position.offset(0, Math.min(target.height / 2, 1.5), 0),
                true,
              ),
            signal,
            "Looking at entity",
          );
          if (this.bot.entityAtCursor(3)?.id !== target.id)
            throw new ActionError("The target is obstructed.");
          if (a.action === "mount") {
            this.bot.mount(target);
            await this.host.until(
              () => this.vehicle()?.id === target.id,
              signal,
            );
            return { summary: "Mounted target; vehicle state confirmed." };
          }
          await this.step(
            () => this.bot.activateEntity(target),
            signal,
            "Entity interaction",
          );
          if (this.bot.currentWindow)
            await this.step(
              () => this.bot.closeWindow(this.bot.currentWindow!),
              signal,
              "Closing entity window",
            );
          return {
            summary:
              "Entity interaction sent; feeding, shearing or trading outcome is not confirmed.",
          };
        },
        a.action !== "dismount",
      );
    }
    if (name === "get_recipes") {
      const a = z.object({ item: itemName }).strict().parse(raw),
        item = this.bot.registry.itemsByName[a.item];
      if (!item) throw new ActionError("Unknown item ID.");
      const available = this.bot.recipesFor(item.id, null, 1, true);
      return {
        item: a.item,
        recipes: this.bot
          .recipesAll(item.id, null, true)
          .slice(0, 16)
          .map((r) => ({
            output: r.result.count,
            requiresTable: r.requiresTable,
            craftableWithInventory: available.some(
              (a) => JSON.stringify(a.delta) === JSON.stringify(r.delta),
            ),
            ingredients: r.delta
              .filter((i) => i.count < 0)
              .map((i) => ({
                item: this.bot.registry.items[i.id]?.name ?? "unknown",
                count: -i.count,
              })),
          })),
      };
    }
    if (name === "craft_item") {
      const a = z
        .object({
          item: itemName,
          count: z.number().int().min(1).max(64),
          table: blockPoint.optional(),
        })
        .strict()
        .parse(raw);
      return this.start(
        "craft",
        async (signal) => {
          const item = this.bot.registry.itemsByName[a.item];
          if (!item) throw new ActionError("Unknown item ID.");
          let table = a.table ? this.blockAt(point(a.table)) : undefined;
          if (table && table.name !== "crafting_table")
            throw new ActionError(
              "The supplied block is not a crafting table.",
            );
          if (!table && !this.bot.recipesFor(item.id, null, 1, null).length)
            table =
              this.bot.findBlock({
                matching: (b) => b.name === "crafting_table",
                maxDistance: 32,
              }) ?? undefined;
          if (table) table = await this.approachBlock(table.position, signal);
          const before = this.inventoryCount(a.item);
          for (let n = 0; n < a.count; n++) {
            this.host.check(signal);
            const recipe = this.bot.recipesFor(
              item.id,
              null,
              1,
              table ?? null,
            )[0];
            if (!recipe)
              throw new ActionError(
                "Missing ingredients or crafting table. Earlier crafting operations, if any, were kept.",
              );
            await this.step(
              () => this.bot.craft(recipe, 1, table),
              signal,
              "Crafting",
              20000,
            );
            this.host.progress(
              `Crafted ${n + 1}/${a.count} operations.`,
              n + 1,
            );
          }
          await this.host.until(
            () => this.inventoryCount(a.item) > before,
            signal,
          );
          return {
            summary: `Crafted ${a.item}; output inventory gain verified.`,
            operations: a.count,
            outputGain: this.inventoryCount(a.item) - before,
          };
        },
        true,
      );
    }
    if (name === "container" || name === "furnace") {
      const a = z
        .object({
          position: blockPoint,
          action: z.enum([
            "inspect",
            "deposit",
            "withdraw",
            "put_input",
            "put_fuel",
            "take_input",
            "take_fuel",
            "take_output",
          ]),
          item: itemName.optional(),
          count: quantity.optional(),
        })
        .strict()
        .parse(raw);
      const containerAction = ["inspect", "deposit", "withdraw"].includes(
        a.action,
      );
      if (
        (name === "container" && !containerAction) ||
        (name === "furnace" && ["deposit", "withdraw"].includes(a.action))
      )
        throw new ActionError("Wrong operation for this window type.");
      if (
        ["deposit", "withdraw", "put_input", "put_fuel"].includes(a.action) &&
        (!a.item || !a.count)
      )
        throw new ActionError("Specify both item and count for a transfer.");
      return this.start(
        name,
        async (signal) => {
          const block = await this.approachBlock(point(a.position), signal);
          if (name === "container") {
            if (
              !/^(chest|trapped_chest|ender_chest|barrel|hopper|dispenser|dropper|(?:[a-z_]+_)?shulker_box)$/.test(
                block.name,
              )
            )
              throw new ActionError(
                "The target is not a supported storage container.",
              );
            const window = await this.step(
              () => this.bot.openContainer(block),
              signal,
              "Opening storage",
              10000,
              async (w) => {
                if (this.bot.currentWindow === w) await w.close();
              },
            );
            const count = (name: string) =>
              window
                .items()
                .filter((i) => i.name === name)
                .reduce((n, i) => n + i.count, 0);
            try {
              if (a.action !== "inspect") {
                const items =
                  a.action === "deposit"
                    ? window.items()
                    : window.containerItems();
                const stack = items.find((i) => i.name === a.item);
                if (
                  !stack ||
                  items
                    .filter((i) => i.name === a.item)
                    .reduce((n, i) => n + i.count, 0) < a.count!
                )
                  throw new ActionError(
                    "The source does not contain the requested quantity.",
                  );
                const before = count(a.item!);
                await this.step(
                  () =>
                    a.action === "deposit"
                      ? window.deposit(stack.type, stack.metadata, a.count!)
                      : window.withdraw(stack.type, stack.metadata, a.count!),
                  signal,
                  "Storage transfer",
                  15000,
                );
                await this.host.until(
                  () =>
                    a.action === "deposit"
                      ? count(a.item!) <= before - a.count!
                      : count(a.item!) >= before + a.count!,
                  signal,
                );
              }
              return {
                summary:
                  a.action === "inspect"
                    ? "Storage contents inspected."
                    : "Storage transfer verified in inventory.",
                items: window.containerItems().slice(0, 54).map(summaryItem),
              };
            } finally {
              if (this.bot.currentWindow === window) await window.close();
            }
          }
          if (!["furnace", "smoker", "blast_furnace"].includes(block.name))
            throw new ActionError(
              "The target is not a furnace, smoker or blast furnace.",
            );
          const window = await this.step(
            () => this.bot.openFurnace(block),
            signal,
            "Opening furnace",
            10000,
            async (w) => {
              if (this.bot.currentWindow === w) await w.close();
            },
          );
          const inventoryCount = (name: string) =>
            window
              .items()
              .filter((i) => i.name === name)
              .reduce((n, i) => n + i.count, 0);
          try {
            if (a.action === "put_input" || a.action === "put_fuel") {
              const item = window.items().find((i) => i.name === a.item),
                before = inventoryCount(a.item!);
              if (!item)
                throw new ActionError("Input/fuel is not in inventory.");
              if (before < a.count!)
                throw new ActionError("Not enough input/fuel in inventory.");
              await this.step(
                () =>
                  a.action === "put_input"
                    ? window.putInput(item.type, item.metadata, a.count!)
                    : window.putFuel(item.type, item.metadata, a.count!),
                signal,
                "Furnace transfer",
                15000,
              );
              await this.host.until(
                () => inventoryCount(a.item!) <= before - a.count!,
                signal,
              );
            } else if (a.action !== "inspect") {
              const item =
                a.action === "take_input"
                  ? window.inputItem()
                  : a.action === "take_fuel"
                    ? window.fuelItem()
                    : window.outputItem();
              if (!item)
                throw new ActionError(
                  "That furnace slot is empty; smelting may still be in progress.",
                );
              const before = inventoryCount(item.name),
                count = item.count;
              await this.step(
                () =>
                  a.action === "take_input"
                    ? window.takeInput()
                    : a.action === "take_fuel"
                      ? window.takeFuel()
                      : window.takeOutput(),
                signal,
                "Taking furnace items",
              );
              await this.host.until(
                () => inventoryCount(item.name) >= before + count,
                signal,
              );
            }
            return {
              summary:
                "Furnace operation finished; smelting completion is separate from inserting input/fuel.",
              input: summaryItem(window.inputItem()),
              fuel: summaryItem(window.fuelItem()),
              output: summaryItem(window.outputItem()),
              progress: window.progress ?? 0,
            };
          } finally {
            if (this.bot.currentWindow === window) await window.close();
          }
        },
        true,
      );
    }
    throw new ActionError("Unknown gameplay tool.");
  }
}
