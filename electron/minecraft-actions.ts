import { setTimeout as delay } from "node:timers/promises";
import { Vec3 } from "vec3";
import { goals } from "mineflayer-pathfinder";
import type { Bot, EquipmentDestination } from "mineflayer";
import { z } from "zod";
import { pointSchema, type MinecraftJob } from "../src/shared/minecraft";
import { minecraftGameplayTools } from "../src/shared/minecraft-gameplay";
import { MinecraftActionError as ActionError } from "./minecraft-action-error";
import { resourcePlan } from "./minecraft-resources";
import {
  itemEnchantments,
  itemCustomName,
  itemFingerprint,
} from "./minecraft-items";
import {
  approachLabels,
  type ApproachDiagnostic,
} from "../src/shared/minecraft-diagnostics";

type Result = Record<string, unknown>;
export interface GameplayHost {
  start(
    kind: MinecraftJob["kind"],
    work: (signal: AbortSignal) => Promise<Result>,
    movement: boolean,
  ): unknown;
  check(signal: AbortSignal): void;
  navigate(point: Vec3, signal: AbortSignal, distance?: number): Promise<void>;
  approachBlock(point: Vec3, signal: AbortSignal): Promise<void>;
  area(point: Vec3): void;
  until(
    test: () => boolean,
    signal: AbortSignal,
    milliseconds?: number,
  ): Promise<void>;
  progress(detail: string, count?: number): void;
  diagnostic(entry: ApproachDiagnostic): void;
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
        enchants: itemEnchantments(i),
        customName: itemCustomName(i)?.slice(0, 200),
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
    await this.host.approachBlock(p, signal);
    this.host.check(signal);
    const block = this.blockAt(p);
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
    if (name === "enchant_item") {
      const a = z
        .object({
          position: blockPoint,
          item: itemName,
          slot: z.number().int().min(0).max(45).optional(),
          action: z.enum(["inspect", "enchant"]),
          choice: z.number().int().min(0).max(2).optional(),
        })
        .strict()
        .parse(raw);
      if (a.action === "enchant" && a.choice === undefined)
        throw new ActionError(
          "Inspect enchantment offers, then choose 0, 1 or 2.",
        );
      return this.start(
        "enchant",
        async (signal) => {
          const block = await this.approachBlock(point(a.position), signal);
          if (block.name !== "enchanting_table")
            throw new ActionError("The target is not an enchanting table.");
          const item = this.inventoryItem(a.item, a.slot);
          if (itemEnchantments(item).length)
            throw new ActionError(
              "Use an unenchanted item at the table; use an anvil for existing enchantments.",
            );
          const originalSlot = item.slot,
            originalFingerprint = itemFingerprint(item);
          if (originalSlot < 9 || originalSlot > 44)
            throw new ActionError(
              "Move the item into the main inventory or hotbar first.",
            );
          const original = this.bot.inventory
            .items()
            .map((i) => ({ fingerprint: itemFingerprint(i), count: i.count }));
          const w = await this.step(
            () => this.bot.openEnchantmentTable(block),
            signal,
            "Opening enchanting table",
            10000,
            async (w) => {
              if (this.bot.currentWindow === w) await w.close();
            },
          );
          try {
            const mapped = w.slots[w.inventoryStart + originalSlot - 9];
            if (!mapped || itemFingerprint(mapped) !== originalFingerprint)
              throw new ActionError(
                "Selected item changed when opening the table. Inspect inventory before retrying.",
              );
            await this.step(
              () => w.putTargetItem(mapped),
              signal,
              "Inserting enchantment item",
            );
            const syncWindow = (
              this.bot as Bot & {
                _syncWindow?: (w: Bot["inventory"]) => Promise<void>;
              }
            )._syncWindow;
            if (this.bot.supportFeature?.("stateIdUsed") && syncWindow)
              await this.step(
                () => syncWindow.call(this.bot, w),
                signal,
                "Confirming enchanting input",
              );
            await this.host.until(
              () =>
                w.enchantments.length === 3 &&
                w.enchantments.every((e) => e.level >= 0) &&
                w.enchantments.some((e) => e.level > 0),
              signal,
            );
            if (
              !w.targetItem() ||
              itemFingerprint(w.targetItem()) !== originalFingerprint
            )
              throw new ActionError(
                "Enchanting input does not match the selected item; nothing enchanted.",
              );
            const offers = w.enchantments.map((e, choice) => ({
              choice,
              requiredLevel: e.level,
              levelAndLapisCost: choice + 1,
              expected: e.expected,
            }));
            if (a.action === "enchant") {
              const offer = offers[a.choice!];
              if (!offer || offer.requiredLevel <= 0)
                throw new ActionError("That enchantment offer is unavailable.");
              if (this.bot.experience.level < offer.requiredLevel)
                throw new ActionError(
                  `Requires experience level ${offer.requiredLevel}.`,
                );
              // The open window owns live inventory slots until it closes.
              const lapis = w
                .items()
                .find(
                  (i) =>
                    i.name === "lapis_lazuli" &&
                    i.count >= offer.levelAndLapisCost,
                );
              if (!lapis)
                throw new ActionError(
                  `Need a stack with ${offer.levelAndLapisCost} lapis lazuli.`,
                );
              await this.step(
                () => w.putLapis(lapis),
                signal,
                "Inserting lapis",
              );
              await this.step(() => w.enchant(a.choice!), signal, "Enchanting");
              await this.host.until(
                () => itemEnchantments(w.targetItem()).length > 0,
                signal,
              );
            }
            const target = w.targetItem();
            if (!target)
              throw new ActionError(
                "Enchanting target disappeared; inspect inventory before retrying.",
              );
            const fingerprint = itemFingerprint(target);
            const previous = original
              .filter((i) => i.fingerprint === fingerprint)
              .reduce((n, i) => n + i.count, 0);
            const expectedCount =
              previous + (a.action === "inspect" ? 0 : target.count);
            const result = summaryItem(target);
            await this.step(
              () => w.takeTargetItem(),
              signal,
              "Returning enchantment item",
            );
            const sync = (
              this.bot as Bot & {
                _syncWindow?: (w: Bot["inventory"]) => Promise<void>;
              }
            )._syncWindow;
            if (this.bot.supportFeature?.("stateIdUsed") && sync)
              await this.step(
                () => sync.call(this.bot, w),
                signal,
                "Confirming enchantment inventory",
              );
            await this.host.until(
              () =>
                w
                  .items()
                  .filter((i) => itemFingerprint(i) === fingerprint)
                  .reduce((n, i) => n + i.count, 0) >= expectedCount,
              signal,
            );
            return {
              summary:
                a.action === "inspect"
                  ? "Enchantment offers inspected; item returned."
                  : "Enchanted item returned to inventory; enchantments observed.",
              offers,
              item: result,
            };
          } finally {
            if (this.bot.currentWindow === w) await w.close();
          }
        },
        true,
      );
    }
    if (name === "anvil_item") {
      const a = z
        .object({
          position: blockPoint,
          first: z.number().int().min(9).max(44),
          second: z.number().int().min(9).max(44).optional(),
          name: z.string().min(1).max(35).optional(),
          action: z.enum(["inspect", "apply"]),
        })
        .strict()
        .parse(raw);
      if (a.second === a.first || (a.second === undefined && !a.name))
        throw new ActionError(
          "Choose distinct input slots for combining, or a name for renaming.",
        );
      return this.start(
        "anvil",
        async (signal) => {
          const block = await this.approachBlock(point(a.position), signal);
          if (!["anvil", "chipped_anvil", "damaged_anvil"].includes(block.name))
            throw new ActionError("The target is not an anvil.");
          if (
            !this.bot.inventory.slots[a.first] ||
            (a.second !== undefined && !this.bot.inventory.slots[a.second])
          )
            throw new ActionError(
              "An input slot is empty; inspect inventory again.",
            );
          type AnvilWindow = Awaited<ReturnType<Bot["openAnvil"]>> &
            Bot["inventory"] & { close(): Promise<void> };
          const w = await this.step(
            async () => (await this.bot.openAnvil(block)) as AnvilWindow,
            signal,
            "Opening anvil",
            10000,
            async (w) => {
              if (this.bot.currentWindow === w) await w.close();
            },
          );
          let levels = -1;
          const cost = (packet: {
            windowId: number;
            property: number;
            value: number;
          }) => {
            if (packet.windowId === w.id && packet.property === 0)
              levels = packet.value;
          };
          this.bot._client.on("craft_progress_bar", cost);
          const sync = async () => {
            const syncWindow = (
              this.bot as Bot & {
                _syncWindow?: (w: Bot["inventory"]) => Promise<void>;
              }
            )._syncWindow;
            if (this.bot.supportFeature?.("stateIdUsed") && syncWindow)
              await this.step(
                () => syncWindow.call(this.bot, w),
                signal,
                "Confirming anvil inventory",
              );
          };
          try {
            // Window slots differ from player inventory slots. No local Item.anvil
            // calculation: it loses modern data components and can mutate inputs.
            await this.step(
              () => this.bot.moveSlotItem(w.inventoryStart + a.first - 9, 0),
              signal,
              "Inserting first anvil item",
            );
            if (a.second !== undefined)
              await this.step(
                () =>
                  this.bot.moveSlotItem(w.inventoryStart + a.second! - 9, 1),
                signal,
                "Inserting second anvil item",
              );
            if (a.name !== undefined) {
              this.host.check(signal);
              this.bot._client.write("name_item", { name: a.name });
            }
            await sync();
            await this.host.until(() => !!w.slots[2] && levels >= 0, signal);
            const output = w.slots[2]!;
            const result = summaryItem(output);
            const requiredLevels = levels;
            if (a.action === "inspect") {
              for (const slot of [0, 1])
                if (w.slots[slot])
                  await this.step(
                    () => this.bot.putAway(slot),
                    signal,
                    "Returning anvil input",
                  );
              await sync();
              return {
                summary:
                  "Minecraft anvil preview; inputs returned. Reinspect inventory slots before applying.",
                levels: requiredLevels,
                item: result,
              };
            }
            if (
              this.bot.game.gameMode !== "creative" &&
              (levels >= 40 || this.bot.experience.level < levels)
            )
              throw new ActionError(
                `Anvil requires ${levels} levels or is too expensive in survival.`,
              );
            const expected = itemFingerprint(output),
              quantity = output.count;
            const countOutput = () =>
              w
                .items()
                .filter((i) => itemFingerprint(i) === expected)
                .reduce((n, i) => n + i.count, 0);
            const before = countOutput();
            await this.step(
              () => this.bot.putAway(2),
              signal,
              "Taking anvil output",
            );
            await sync();
            await this.host.until(
              () => countOutput() >= before + quantity,
              signal,
            );
            return {
              summary: "Server-previewed anvil output verified in inventory.",
              levels: requiredLevels,
              item: result,
            };
          } finally {
            this.bot._client.removeListener("craft_progress_bar", cost);
            if (this.bot.currentWindow === w) await w.close();
          }
        },
        true,
      );
    }
    if (name === "fish") {
      const a = z
        .object({
          water: blockPoint.optional(),
          catches: z.number().int().min(1).max(16).default(1),
          seconds: z.number().int().min(5).max(90).default(60),
        })
        .strict()
        .parse(raw);
      return this.start(
        "fish",
        async (signal) => {
          const water = a.water
            ? this.blockAt(point(a.water))
            : this.bot.findBlock({
                matching: (b) => b.name === "water",
                maxDistance: 6,
              });
          if (
            !water ||
            water.name !== "water" ||
            water.position.distanceTo(this.bot.entity.position) > 6
          )
            throw new ActionError(
              "Stand near loaded water with a clear cast first.",
            );
          const gains: Record<string, number> = {};
          for (let i = 0; i < a.catches; i++) {
            if (!this.bot.inventory.slots.slice(9, 45).some((slot) => !slot))
              throw new ActionError(
                "Make a free inventory slot before fishing; an unknown catch may not stack. Nothing cast.",
              );
            await this.step(
              () => this.bot.equip(this.inventoryItem("fishing_rod"), "hand"),
              signal,
              "Holding fishing rod",
            );
            await this.step(
              () => this.bot.lookAt(water.position.offset(0.5, 0.8, 0.5), true),
              signal,
              "Aiming cast",
            );
            const before = new Map(
              this.bot.inventory
                .items()
                .map((v) => [v.name, this.inventoryCount(v.name)]),
            );
            const oldEntities = new Set(Object.values(this.bot.entities));
            const shore = this.bot.entity.position.clone();
            let active = false;
            const reel = () => {
              if (active) {
                active = false;
                this.bot.activateItem();
              }
            };
            signal.addEventListener("abort", reel, { once: true });
            try {
              await this.step(
                async () => {
                  active = true;
                  try {
                    await this.bot.fish();
                  } finally {
                    active = false;
                  }
                },
                signal,
                "Waiting for a fishing bite",
                a.seconds * 1000,
              );
            } finally {
              reel();
              signal.removeEventListener("abort", reel);
            }
            const caught = () =>
              [
                ...new Set(this.bot.inventory.items().map((v) => v.name)),
              ].filter(
                (name) =>
                  name !== "fishing_rod" &&
                  this.inventoryCount(name) > (before.get(name) ?? 0),
              );
            try {
              await this.host.until(() => caught().length > 0, signal, 5000);
            } catch (error) {
              signal.throwIfAborted();
              const drop = Object.values(this.bot.entities)
                .filter(
                  (e) =>
                    !oldEntities.has(e) &&
                    e.name === "item" &&
                    e.isValid !== false &&
                    e.position.distanceTo(shore) <= 8,
                )
                .sort(
                  (a, b) =>
                    a.position.distanceTo(shore) - b.position.distanceTo(shore),
                )[0];
              if (drop) {
                await this.host.navigate(drop.position.clone(), signal, 1);
                try {
                  await this.host.until(
                    () => caught().length > 0,
                    signal,
                    5000,
                  );
                } catch {
                  signal.throwIfAborted();
                  throw new ActionError(
                    "Fishing drop approached, but pickup remains unconfirmed; inspect before another cast.",
                  );
                }
                await this.host.navigate(shore, signal, 1);
              } else
                throw new ActionError(
                  "Reeled in, but no collected inventory gain or newly spawned nearby drop was confirmed. Check the water/shore and free inventory space; no automatic recast.",
                );
            }
            for (const name of caught())
              gains[name] =
                (gains[name] ?? 0) +
                this.inventoryCount(name) -
                (before.get(name) ?? 0);
            this.host.progress(
              `Fishing: ${i + 1}/${a.catches} reels followed by inventory gain.`,
              i + 1,
            );
          }
          return {
            summary:
              "Fishing completed; inventory gains observed (nearby unrelated pickups cannot be excluded).",
            gains,
          };
        },
        true,
      );
    }
    if (name === "steer_vehicle") {
      const a = z
        .object({
          left: z.number().min(-1).max(1),
          forward: z.number().min(-1).max(1),
          milliseconds: z.number().int().min(100).max(5000),
        })
        .strict()
        .parse(raw);
      return this.start(
        "vehicle",
        async (signal) => {
          const vehicle = this.vehicle();
          if (!vehicle)
            throw new ActionError("Mount a steerable vehicle first.");
          const before = vehicle.position.clone();
          const end = Date.now() + a.milliseconds;
          try {
            while (Date.now() < end) {
              this.host.check(signal);
              if (this.vehicle() !== vehicle)
                throw new ActionError("The mount changed; steering stopped.");
              this.bot.moveVehicle(a.left, a.forward);
              await delay(
                Math.min(100, Math.max(1, end - Date.now())),
                undefined,
                { signal },
              );
            }
          } finally {
            this.bot.moveVehicle(0, 0);
          }
          const displacement = before.distanceTo(vehicle.position);
          if ((a.left || a.forward) && displacement < 0.1)
            throw new ActionError(
              "Steering input sent but no vehicle movement observed. This mount/server may need a control item or unsupported vehicle physics. No automatic retry.",
            );
          return {
            summary:
              "Steering stopped; observed displacement reported, not arrival.",
            displacement,
            position: vehicle.position,
          };
        },
        true,
      );
    }
    if (name === "trade_villager") {
      const a = z
        .object({
          entityId: idSchema,
          action: z.enum(["inspect", "trade"]),
          index: z.number().int().min(0).max(99).optional(),
          item: itemName.optional(),
          input1: itemName.optional(),
          input2: itemName.nullable().optional(),
          count: z.number().int().min(1).max(64).optional(),
          price1: quantity.optional(),
          price2: z.number().int().min(0).max(1024).optional(),
        })
        .strict()
        .parse(raw);
      if (
        a.action === "trade" &&
        [a.index, a.item, a.input1, a.input2, a.count, a.price1, a.price2].some(
          (v) => v === undefined,
        )
      )
        throw new ActionError(
          "Inspect offers first, then supply index, expected input1/input2 IDs (input2=null if absent), output item, operation count and both maximum unit prices.",
        );
      return this.start(
        "trade",
        async (signal) => {
          const target = this.entity(a.entityId);
          if (target.name !== "villager")
            throw new ActionError("Select a currently observed villager.");
          await this.host.navigate(target.position, signal, 2);
          if (
            this.entity(a.entityId) !== target ||
            target.position.distanceTo(this.bot.entity.position) > 3
          )
            throw new ActionError(
              "Villager moved out of reach; observe again.",
            );
          await this.step(
            () => this.bot.lookAt(target.position.offset(0, 1, 0), true),
            signal,
            "Looking at villager",
          );
          if (this.bot.entityAtCursor(3)?.id !== target.id)
            throw new ActionError(
              "Villager is behind another block/entity; move to a visible approach.",
            );
          const window = await this.step(
            () => this.bot.openVillager(target),
            signal,
            "Opening villager offers",
            10000,
            async (w) => {
              if (this.bot.currentWindow === w) await w.close();
            },
          );
          try {
            const offers = () =>
              window.trades
                .slice(0, 100)
                .map((t, index) => ({
                  index,
                  input1: {
                    item: t.inputItem1.name,
                    count: t.realPrice ?? t.inputItem1.count,
                  },
                  input2:
                    t.hasItem2 && t.inputItem2
                      ? { item: t.inputItem2.name, count: t.inputItem2.count }
                      : null,
                  output: summaryItem(t.outputItem),
                  remaining: Math.max(0, t.maximumNbTradeUses - t.nbTradeUses),
                  disabled: t.tradeDisabled,
                }));
            if (a.action === "inspect")
              return {
                summary: "Current villager offers inspected.",
                offers: offers(),
              };
            const countOutput = (fingerprint: string) =>
              window
                .items()
                .filter((i) => itemFingerprint(i) === fingerprint)
                .reduce((n, i) => n + i.count, 0);
            let outputGain = 0;
            for (let n = 0; n < a.count!; n++) {
              this.host.check(signal);
              const t = window.trades[a.index!];
              if (
                !t ||
                t.tradeDisabled ||
                t.maximumNbTradeUses <= t.nbTradeUses ||
                t.outputItem.name !== a.item ||
                t.inputItem1.name !== a.input1 ||
                (t.hasItem2 ? t.inputItem2?.name : null) !== a.input2 ||
                (t.realPrice ?? t.inputItem1.count) > a.price1! ||
                (t.hasItem2 ? (t.inputItem2?.count ?? Infinity) : 0) > a.price2!
              )
                throw new ActionError(
                  `Offer unavailable or changed; ${n} operations verified. Inspect before retrying.`,
                );
              const fingerprint = itemFingerprint(t.outputItem),
                previous = countOutput(fingerprint);
              if (
                [t.inputItem1, t.inputItem2].some(
                  (i) => i && itemFingerprint(i) === fingerprint,
                )
              )
                throw new ActionError(
                  "This offer consumes identical output items; a gain cannot be verified. Nothing traded.",
                );
              await this.step(
                () => this.bot.trade(window, a.index!, 1),
                signal,
                "Villager trade",
                15000,
              );
              const sync = (
                this.bot as Bot & {
                  _syncWindow?: (w: Bot["inventory"]) => Promise<void>;
                }
              )._syncWindow;
              if (this.bot.supportFeature?.("stateIdUsed") && sync)
                await this.step(
                  () => sync.call(this.bot, window),
                  signal,
                  "Confirming trade inventory",
                );
              await this.host.until(
                () => countOutput(fingerprint) >= previous + t.outputItem.count,
                signal,
              );
              outputGain += t.outputItem.count;
              this.host.progress(
                `Traded ${n + 1}/${a.count} operations; output gain verified.`,
                n + 1,
              );
            }
            return {
              summary: "Trading output inventory gain and metadata verified.",
              outputGain,
              offers: offers(),
            };
          } finally {
            if (this.bot.currentWindow === window) await window.close();
          }
        },
        true,
      );
    }
    if (name === "plan_resources") {
      const a = z
        .object({ item: itemName, count: z.number().int().min(1).max(4096) })
        .strict()
        .parse(raw);
      if (!this.bot.registry.itemsByName[a.item])
        throw new ActionError("Unknown item ID.");
      return resourcePlan(this.bot, a.item, a.count);
    }
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
          if (this.bot.isSleeping)
            return { summary: "Already sleeping.", outcome: "sleeping" };
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
            outcome: "sleeping",
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
          entityUuid: z.string().uuid().optional(),
          mode: z.enum(["hit", "fight"]).default("hit"),
          equipBest: z.boolean().default(false),
          retreatHealth: z.number().min(0).max(20).default(0),
          retreatTo: blockPoint.optional(),
          seconds: z.number().int().min(1).max(120).default(30),
        })
        .strict()
        .parse(raw);
      return this.start(
        "combat",
        async (signal) => {
          const target = this.entity(a.entityId);
          if (a.entityUuid && target.uuid !== a.entityUuid)
            throw new ActionError(
              "The target identity changed; observe again before attacking.",
            );
          if (a.equipBest) {
            const tier: Record<string, number> = {
              wooden: 1,
              golden: 1,
              stone: 2,
              copper: 2,
              iron: 3,
              diamond: 4,
              netherite: 5,
            };
            const weapon = this.bot.inventory
              .items()
              .filter((i) => /_(sword|axe)$/.test(i.name))
              .sort(
                (a, b) =>
                  (tier[b.name.split("_")[0]] ?? 0) * 2 +
                  Number(b.name.endsWith("_sword")) -
                  ((tier[a.name.split("_")[0]] ?? 0) * 2 +
                    Number(a.name.endsWith("_sword"))),
              )[0];
            if (weapon)
              await this.step(
                () => this.bot.equip(weapon, "hand"),
                signal,
                "Equipping a melee weapon",
              );
          }
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
                  entityUuid: target.uuid,
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
              if (a.retreatHealth > 0 && this.bot.health <= a.retreatHealth) {
                this.bot.pathfinder.setGoal(null);
                if (a.retreatTo)
                  await this.host.navigate(point(a.retreatTo), signal, 2);
                throw new ActionError(
                  a.retreatTo
                    ? "Retreated at the selected low-health threshold; target defeat is not confirmed."
                    : "Stopped fighting at the selected low-health threshold; choose a retreat or healing action.",
                );
              }
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
                entityId: target.id,
                entityUuid: target.uuid,
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
          // Modern inventory clicks are optimistic. Mineflayer's server-sync
          // barrier is needed even for the 2x2 inventory grid: craft() only
          // synchronizes a table window, and can otherwise return phantom output.
          const syncInventory = (
            this.bot as Bot & {
              _syncWindow?: (window: Bot["inventory"]) => Promise<void>;
            }
          )._syncWindow;
          const needsSync = this.bot.supportFeature?.("stateIdUsed");
          if (needsSync && !syncInventory)
            throw new ActionError(
              "The installed Minecraft adapter cannot confirm inventory state. Update Mineflayer before crafting; nothing was crafted.",
            );
          if (needsSync)
            await this.step(
              () => syncInventory!.call(this.bot, this.bot.inventory),
              signal,
              "Inventory synchronization",
            );
          // A table coordinate is a hint, not evidence: models often supply the
          // base position or a stale placement. Prefer inventory crafting when possible.
          let table: ReturnType<Bot["blockAt"]> = null;
          if (!this.bot.recipesFor(item.id, null, 1, null).length) {
            if (!this.bot.recipesFor(item.id, null, 1, true).length)
              throw new ActionError(
                "Missing crafting ingredients. Use get_recipes and gather the required items first; nothing was crafted.",
              );
            const hinted = a.table ? this.bot.blockAt(point(a.table)) : null;
            const candidates = [
              ...(hinted?.name === "crafting_table" ? [hinted.position] : []),
              ...this.bot
                .findBlocks({
                  matching: (b) => b.name === "crafting_table",
                  maxDistance: 32,
                  count: 8,
                })
                .sort(
                  (a, b) =>
                    a.distanceTo(this.bot.entity.position) -
                    b.distanceTo(this.bot.entity.position),
                ),
            ].filter((p, i, all) => all.findIndex((v) => v.equals(p)) === i);
            if (!candidates.length)
              throw new ActionError(
                "No loaded crafting table within 32 blocks. Find or place one, then craft again; table coordinates must identify the table block, not the base or floor.",
              );
            const attempts: ApproachDiagnostic[] = [];
            for (const position of candidates) {
              this.host.check(signal);
              const startedAt = new Date().toISOString();
              const report = (outcome: ApproachDiagnostic["outcome"]) => {
                const entry = {
                  position: { x: position.x, y: position.y, z: position.z },
                  startedAt,
                  elapsedMs: Math.max(0, Date.now() - Date.parse(startedAt)),
                  outcome,
                };
                this.host.diagnostic(entry);
                if (outcome !== "approaching") attempts.push(entry);
              };
              const current = this.bot.blockAt(position);
              if (current?.name !== "crafting_table") {
                report(current ? "target_changed" : "unloaded");
                continue;
              }
              try {
                report("approaching");
                this.host.progress(
                  `Approaching crafting table at (${position.x}, ${position.y}, ${position.z}).`,
                );
                const reached = await this.approachBlock(position, signal);
                if (reached.name === "crafting_table") {
                  report("reached");
                  table = reached;
                  break;
                }
                report("target_changed");
              } catch (error) {
                // The engine finalizes diagnostics on Stop. A cancelled action
                // must not publish into a replacement job's diagnostics.
                signal.throwIfAborted();
                const outcome =
                  error instanceof Error
                    ? error.name === "NoPath"
                      ? "no_path"
                      : error.name === "Timeout"
                        ? "search_timeout"
                        : error.name === "InteractionBlocked"
                          ? "interaction_blocked"
                          : undefined
                    : undefined;
                report(outcome ?? "failed");
                this.host.check(signal);
                // Only route failures may try another station, before any crafting I/O.
                if (!outcome) throw error;
              }
            }
            if (!table)
              throw new ActionError(
                `No usable table approach (${attempts.length} checked); nothing crafted. ` +
                  attempts
                    .slice(0, 2)
                    .map(
                      (d) =>
                        `(${d.position.x},${d.position.y},${d.position.z}): ${approachLabels[d.outcome]}.`,
                    )
                    .join(" ") +
                  " See Crafting-table approaches for all attempts.",
              );
          }
          const before = this.inventoryCount(a.item);
          for (let n = 0; n < a.count; n++) {
            this.host.check(signal);
            if (table) {
              const current = this.blockAt(table.position);
              if (current.name !== "crafting_table")
                throw new ActionError(
                  "The crafting table changed before use. Inspect the world; completed crafting operations were kept.",
                );
              table = await this.approachBlock(current.position, signal);
              if (table.name !== "crafting_table")
                throw new ActionError(
                  "The crafting table changed while approaching it; no further crafting was attempted.",
                );
            }
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
            const operationBefore = this.inventoryCount(a.item);
            await this.step(
              async () => {
                const click = this.bot.clickWindow;
                if (needsSync)
                  this.bot.clickWindow = async (...args) => {
                    await click.apply(this.bot, args);
                    await syncInventory!.call(
                      this.bot,
                      this.bot.currentWindow ?? this.bot.inventory,
                    );
                  };
                try {
                  await this.bot.craft(recipe, 1, table ?? undefined);
                  if (needsSync)
                    await syncInventory!.call(this.bot, this.bot.inventory);
                } finally {
                  // The action owner prevents competing inventory operations.
                  // Restore even after rejection; pending operations stay fenced.
                  if (needsSync) this.bot.clickWindow = click;
                }
              },
              signal,
              "Crafting",
              20000,
            );
            // A resolved craft promise is not proof of the requested quantity.
            // Verify each operation before sending the next inventory mutation.
            try {
              await this.host.until(
                () =>
                  this.inventoryCount(a.item) >=
                  operationBefore + recipe.result.count,
                signal,
              );
            } catch (error) {
              signal.throwIfAborted();
              throw new ActionError(
                `Crafting output incomplete: verified ${n}/${a.count} operations; expected ${recipe.result.count} ${a.item} from this operation, observed gain ${this.inventoryCount(a.item) - operationBefore}. Effects may be partial; inspect inventory before retrying.`,
              );
            }
            this.host.progress(
              `Crafted ${n + 1}/${a.count} operations; output verified.`,
              n + 1,
            );
          }
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
