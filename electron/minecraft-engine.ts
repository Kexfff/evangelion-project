import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Vec3 } from "vec3";
import { Movements, goals } from "mineflayer-pathfinder";
import type { Bot } from "mineflayer";
import { MinecraftLocator } from "./minecraft-locator";
import { MinecraftActions } from "./minecraft-actions";
import { canInteractFrom, GoalInteractBlock } from "./minecraft-interaction";
import { DoorNavigation, doorMovements } from "./minecraft-doors";
import { MinecraftActionError } from "./minecraft-action-error";
import { z } from "zod";
import {
  pointSchema,
  type MinecraftConfig,
  type MinecraftJob,
  type MinecraftLive,
} from "../src/shared/minecraft";

export function gameFailureDetail(error: unknown) {
  if (error instanceof MinecraftActionError) return error.message.slice(0, 300);
  if (error instanceof Error && error.name === "NoPath")
    return "No walkable route with the current terrain, inventory and tool permissions. Try a closer waypoint or another entrance.";
  if (error instanceof Error && error.name === "Timeout")
    return "Path search timed out. Try a closer waypoint or a less obstructed route.";
  return "Game action failed unexpectedly. Check the connection and try a new action; nothing was replayed.";
}

export function inRadius(
  point: { x: number; y: number; z: number },
  center: { x: number; y: number; z: number },
  radius: number,
) {
  return (
    Math.hypot(point.x - center.x, point.y - center.y, point.z - center.z) <=
    radius
  );
}
export function safeMovements(
  bot: Bot,
  anchor: Vec3,
  radius: number,
  terrainChanges = false,
  editArea?: { center: { x: number; y: number; z: number }; radius: number },
  doors = terrainChanges,
) {
  const movement = new Movements(bot);
  movement.canDig = terrainChanges;
  movement.allow1by1towers = terrainChanges;
  movement.allowParkour = true;
  movement.allowSprinting = true;
  doorMovements(
    movement,
    doors,
    (p) => !editArea?.radius || inRadius(p, editArea.center, editArea.radius),
  );
  if (!terrainChanges) movement.scafoldingBlocks = [];
  movement.maxDropDown = 4;
  movement.infiniteLiquidDropdownDistance = false;
  for (const name of [
    "farmland",
    "turtle_egg",
    "sweet_berry_bush",
    "powder_snow",
    "magma_block",
    "campfire",
    "lava",
  ]) {
    const block = bot.registry.blocksByName[name];
    if (block) movement.blocksToAvoid.add(block.id);
  }
  movement.exclusionAreasStep = [
    (block) => (!radius || inRadius(block.position, anchor, radius) ? 0 : 100),
  ];
  if (terrainChanges && editArea?.radius) {
    const allowed = (block: { position: Vec3 }) =>
      inRadius(block.position, editArea.center, editArea.radius) ? 0 : 100;
    movement.exclusionAreasBreak = [allowed];
    movement.exclusionAreasPlace = [allowed];
  }
  return movement;
}

/** One game-action owner. Jobs run locally without holding a conversation turn or calling an LLM. */
export class MinecraftEngine {
  job?: MinecraftJob;
  private action?: AbortController;
  private anchor?: Vec3;
  private sequence = 0;
  private locator: MinecraftLocator;
  private gameplay: MinecraftActions;
  private doors: DoorNavigation;
  private workTail: Promise<unknown> = Promise.resolve();
  constructor(
    readonly config: MinecraftConfig,
    private bot: Bot,
    private publish: () => void,
  ) {
    this.locator = new MinecraftLocator(bot, config.operatorLookup);
    this.doors = new DoorNavigation(
      bot,
      (p) =>
        !!this.action &&
        this.config.navigationDoors &&
        (!p ||
          !this.config.buildRadius ||
          inRadius(p, this.config.buildCenter, this.config.buildRadius)),
      (reason) => this.stop(reason),
    );
    this.gameplay = new MinecraftActions(bot, {
      start: (kind, work, movement) => this.begin(kind, 0, work, movement),
      check: (signal) => this.check(signal),
      navigate: (point, signal, distance) =>
        this.navigate(point, signal, distance),
      approachBlock: (point, signal) => this.navigate(point, signal, 2, true),
      area: (point) => this.area(point),
      until: (check, signal, milliseconds) =>
        this.until(check, signal, milliseconds),
      progress: (detail, count) => {
        if (this.job?.status !== "running") return;
        this.job.detail = detail.slice(0, 300);
        if (count !== undefined) this.job.progress = count;
        this.publish();
      },
    });
  }
  ready() {
    this.locator.setOperatorEnabled(this.config.operatorLookup);
    const p = this.bot.entity.position;
    this.anchor ??= new Vec3(p.x, p.y, p.z);
    this.bot.pathfinder.setMovements(
      safeMovements(
        this.bot,
        this.anchor,
        this.config.radius,
        this.config.freePlay &&
          this.config.modifyBlocks &&
          this.config.navigationBlocks,
        { center: this.config.buildCenter, radius: this.config.buildRadius },
        this.config.navigationDoors,
      ),
    );
    this.bot.pathfinder.thinkTimeout = 5000;
  }
  observe(): MinecraftLive {
    const bot = this.bot;
    const blocks: { name: string; position: Vec3 }[] = [];
    const origin = bot.entity.position.floored();
    for (let y = -1; y <= 2; y++)
      for (let x = -4; x <= 4; x += 2)
        for (let z = -4; z <= 4; z += 2) {
          const block = bot.blockAt(origin.offset(x, y, z));
          if (
            block &&
            !["air", "cave_air", "void_air"].includes(block.name) &&
            blocks.length < 24
          )
            blocks.push({ name: block.name, position: block.position });
        }
    return {
      status: "Connected",
      connected: true,
      position: bot.entity.position,
      dimension: bot.game.dimension,
      health: bot.health,
      food: bot.food,
      sleeping: bot.isSleeping,
      riding: !!(bot as Bot & { vehicle?: unknown }).vehicle,
      timeOfDay: bot.time?.timeOfDay,
      gameMode: bot.game.gameMode,
      players: Object.keys(bot.players).slice(0, 100),
      playerLocations: this.locator.locations(),
      blocks,
      limits: {
        movement: this.config.movement,
        freePlay: this.config.freePlay,
        operatorLookup: this.config.operatorLookup,
        chat: this.config.chat,
        modifyBlocks: this.config.modifyBlocks,
        radius: this.config.radius,
        movementAnchor: this.anchor!,
        buildCenter: this.config.buildCenter,
        buildRadius: this.config.buildRadius,
        maxBlocks: this.config.maxBlocks,
        jobSeconds: this.config.jobSeconds,
      },
      inventory: bot.inventory
        .items()
        .slice(0, 50)
        .map((i) => ({ name: i.name, count: i.count })),
      nearby: Object.values(bot.entities)
        .filter(
          (e) =>
            e !== bot.entity &&
            e.position.distanceTo(bot.entity.position) <= 16,
        )
        .sort(
          (a, b) =>
            a.position.distanceTo(bot.entity.position) -
            b.position.distanceTo(bot.entity.position),
        )
        .slice(0, 24)
        .map((e) => ({
          name: (e.username ?? e.name ?? "entity").slice(0, 100),
          id: e.id,
          type: e.type?.slice(0, 100),
          kind: e.kind?.slice(0, 100),
          position: e.position,
        })),
      job: this.job,
    };
  }
  guard() {
    if (
      !this.anchor ||
      !this.bot.entity ||
      (!this.config.freePlay &&
        this.bot.game.dimension !== this.config.dimension)
    )
      throw new MinecraftActionError(
        "Unexpected dimension or world is not ready.",
      );
    if (
      this.config.radius &&
      !inRadius(this.bot.entity.position, this.anchor, this.config.radius)
    )
      throw new MinecraftActionError("Movement boundary reached.");
    if (!this.config.freePlay && this.bot.health <= 4)
      throw new MinecraftActionError("Health is low; action stopped.");
  }
  stop(reason = "Stopped by user.") {
    this.doors.stop();
    this.locator.cancel();
    ++this.sequence;
    this.action?.abort();
    this.action = undefined;
    this.bot.pathfinder.setGoal(null);
    this.bot.clearControlStates();
    this.bot.stopDigging();
    this.bot.deactivateItem?.();
    if (this.job?.status === "running") {
      this.job.status = "cancelled";
      this.job.detail = reason;
      this.job.updatedAt = new Date().toISOString();
    }
    this.publish();
  }
  tick() {
    if (!this.action) return;
    try {
      this.guard();
      this.doors.tick();
    } catch (e) {
      this.stop(e instanceof Error ? e.message : "World changed.");
    }
  }
  private check(signal: AbortSignal) {
    signal.throwIfAborted();
    this.guard();
  }
  dispose() {
    this.stop();
    this.doors.dispose();
  }
  private async until(
    check: () => boolean,
    signal: AbortSignal,
    milliseconds = 8000,
  ) {
    const end = Date.now() + milliseconds;
    while (!check()) {
      this.check(signal);
      if (Date.now() > end)
        throw new MinecraftActionError("Expected world change did not occur.");
      await delay(100, undefined, { signal });
    }
    this.check(signal);
  }
  private async navigate(
    target: { x: number; y: number; z: number },
    signal: AbortSignal,
    distance = 1,
    interaction = false,
  ) {
    const point = new Vec3(target.x, target.y, target.z);
    this.check(signal);
    if (
      !this.anchor ||
      (this.config.radius && !inRadius(point, this.anchor, this.config.radius))
    )
      throw new MinecraftActionError(
        "Target is outside the permitted movement radius.",
      );
    if (
      interaction &&
      canInteractFrom(this.bot, this.bot.entity.position, point)
    )
      return;
    await this.bot.pathfinder.goto(
      interaction
        ? new GoalInteractBlock(this.bot, point)
        : new goals.GoalNear(point.x, point.y, point.z, distance),
    );
    this.check(signal);
    if (interaction) {
      if (!canInteractFrom(this.bot, this.bot.entity.position, point))
        throw Object.assign(
          new MinecraftActionError(
            "The route ended without a clear, in-reach view of the block. Check the entrance or a changed obstruction; no interaction was sent.",
          ),
          { name: "NoPath" },
        );
      return;
    }
    if (this.bot.entity.position.distanceTo(point) > distance + 1.5)
      throw new MinecraftActionError("Destination was not reached.");
  }
  private area(point: { x: number; y: number; z: number }) {
    if (
      this.config.buildRadius &&
      !inRadius(point, this.config.buildCenter, this.config.buildRadius)
    )
      throw new MinecraftActionError(
        "Block is outside the approved build area.",
      );
    if (
      !this.anchor ||
      (this.config.radius && !inRadius(point, this.anchor, this.config.radius))
    )
      throw new MinecraftActionError("Block is outside movement limits.");
  }
  private begin(
    kind: MinecraftJob["kind"],
    total: number,
    work: (signal: AbortSignal) => Promise<void | Record<string, unknown>>,
    requiresMovement = true,
  ) {
    this.guard();
    if (requiresMovement && !this.config.movement)
      throw new MinecraftActionError("Movement permission is off.");
    if (this.action)
      if (this.config.freePlay) this.stop("Replaced by a new game action.");
      else
        throw new MinecraftActionError(
          "Another game job owns movement. Stop it before starting a new job.",
        );
    const controller = new AbortController(),
      sequence = ++this.sequence;
    this.action = controller;
    const now = new Date().toISOString();
    this.job = {
      id: randomUUID(),
      kind,
      status: "running",
      detail: "Started; not completed.",
      progress: 0,
      total,
      startedAt: now,
      updatedAt: now,
      characterId: this.config.characterId,
      worldId: this.config.worldId,
    };
    this.publish();
    const timer = this.config.jobSeconds
      ? setTimeout(
          () => this.stop("Job time limit reached."),
          this.config.jobSeconds * 1000,
        )
      : undefined;
    // Replacements wait for the previous action's cleanup before touching inventory,
    // controls or windows. Chat still receives its action ID immediately.
    const task = this.workTail
      .catch(() => {})
      .then(async () => {
        this.check(controller.signal);
        await this.gameplay.idle(controller.signal);
        await this.doors.idle(controller.signal);
        this.check(controller.signal);
        return work(controller.signal);
      });
    this.workTail = task.catch(() => {});
    void task
      .then((result) => {
        if (sequence !== this.sequence || controller.signal.aborted) return;
        this.job!.status = "succeeded";
        this.job!.detail =
          typeof result?.summary === "string"
            ? result.summary.slice(0, 300)
            : "Completion verified.";
        if (result) this.job!.result = result;
      })
      .catch((error: unknown) => {
        if (sequence !== this.sequence) return;
        this.job!.status = "failed";
        this.job!.detail = gameFailureDetail(error);
      })
      .finally(() => {
        clearTimeout(timer);
        if (sequence !== this.sequence) return;
        this.action = undefined;
        this.bot.pathfinder.setGoal(null);
        this.bot.clearControlStates();
        this.job!.updatedAt = new Date().toISOString();
        this.publish();
      });
    return {
      jobId: this.job.id,
      status: "running",
      instruction:
        "Action accepted in the background, not completed. Internal bookkeeping only: do not narrate job/status details in chat. Check status when the user asks or a meaningful outcome is needed.",
    };
  }
  async call(name: string, raw: unknown) {
    if (name === "locate_player") {
      const { player } = z
        .object({ player: z.string().regex(/^[a-zA-Z0-9_]{1,16}$/) })
        .strict()
        .parse(raw);
      const selected =
        Object.keys(this.bot.players).find(
          (p) => p.toLowerCase() === player.toLowerCase(),
        ) ?? player;
      return this.locator.locate(selected);
    }
    if (name === "stop_action") {
      this.stop();
      return { stopped: true };
    }
    if (name === "observe") {
      const { positions } = z
        .object({ positions: z.array(pointSchema).max(8).default([]) })
        .strict()
        .parse(raw);
      return {
        ...this.observe(),
        inspectedBlocks: positions.map((p) => {
          const block = this.bot.blockAt(new Vec3(p.x, p.y, p.z));
          return { position: p, name: block?.name ?? null };
        }),
      };
    }
    if (name === "job_status") return this.job ?? { status: "idle" };
    this.guard();
    if (this.gameplay.handles(name)) return this.gameplay.call(name, raw);
    if (name === "say_in_game") {
      const { text } = z
        .object({
          text: z
            .string()
            .trim()
            .min(1)
            .max(200)
            .refine(
              (s) => !s.startsWith("/") && !/[\r\n\x00-\x1f]/.test(s),
              "Commands and control characters are forbidden.",
            ),
        })
        .strict()
        .parse(raw);
      if (!this.config.chat)
        throw new MinecraftActionError("Public chat permission is off.");
      this.bot.chat(text);
      return { sent: true, audience: "public game chat" };
    }
    if (name === "move_to") {
      const p = pointSchema.parse(raw);
      return this.begin("move", 1, async (signal) => {
        await this.navigate(new Vec3(p.x, p.y, p.z), signal);
        this.job!.progress = 1;
      });
    }
    if (name === "follow_player") {
      const { player } = z
        .object({
          player: z
            .string()
            .regex(/^[a-zA-Z0-9_]{1,16}$/)
            .optional(),
        })
        .strict()
        .parse(raw);
      const others = Object.keys(this.bot.players).filter(
        (p) => p !== this.bot.username,
      );
      const preferred = player || this.config.trustedPlayer;
      const selected = preferred
        ? (Object.keys(this.bot.players).find(
            (p) => p.toLowerCase() === preferred.toLowerCase(),
          ) ?? preferred)
        : others.length === 1
          ? others[0]
          : "";
      if (!selected || selected === this.bot.username)
        throw new MinecraftActionError(
          "Specify which player to follow, or set a preferred player in Minecraft settings.",
        );
      return this.begin("follow", 0, async (signal) => {
        let tracked: Bot["entity"] | undefined;
        let followGoal: goals.GoalFollow | undefined;
        let waypoint: Vec3 | undefined;
        let missingSince: number | undefined;
        let lastMotion = Date.now(),
          lastPosition = this.bot.entity.position.clone();
        let pathStatus = "searching";
        const onPath = (result: { status: string }) => {
          pathStatus = result.status;
        };
        this.bot.on("path_update", onPath);
        try {
          while (!signal.aborted) {
            this.check(signal);
            const target = this.bot.players[selected]?.entity;
            if (!target) {
              if (tracked) this.bot.pathfinder.setGoal(null);
              tracked = undefined;
              const location = await this.locator.locate(
                selected,
                signal,
                this.config.backgroundLookup,
              );
              this.check(signal);
              if (
                location.position &&
                location.dimension === this.bot.game.dimension
              ) {
                const point = new Vec3(
                  location.position.x,
                  location.position.y,
                  location.position.z,
                );
                if (
                  this.config.radius &&
                  !inRadius(point, this.anchor!, this.config.radius)
                )
                  throw new MinecraftActionError(
                    "Player coordinates are outside the configured movement leash. Set radius to 0 to roam freely.",
                  );
                if (!waypoint || waypoint.distanceTo(point) > 3) {
                  waypoint = point;
                  this.bot.pathfinder.setGoal(
                    new goals.GoalNear(point.x, point.y, point.z, 3),
                  );
                  lastMotion = Date.now();
                  lastPosition = this.bot.entity.position.clone();
                }
                const distance = point.distanceTo(this.bot.entity.position);
                this.job!.detail = `Approaching ${selected}: ${Math.round(distance)} blocks to ${location.source === "last_seen" ? "last-seen (possibly stale)" : "server-reported"} coordinates.`;
                if (this.bot.entity.position.distanceTo(lastPosition) >= 0.5) {
                  lastMotion = Date.now();
                  lastPosition = this.bot.entity.position.clone();
                }
                if (distance > 4) {
                  if (Date.now() - lastMotion >= 20000)
                    throw new MinecraftActionError(
                      "No progress toward the player's known coordinates for 20 seconds. Route may be obstructed or chunks unavailable.",
                    );
                  missingSince = undefined;
                  this.publish();
                  await delay(1000, undefined, { signal });
                  continue;
                }
              }
              missingSince ??= Date.now();
              this.job!.detail =
                location.position &&
                location.dimension !== this.bot.game.dimension
                  ? `${selected} is in ${location.dimension}; Eva is in ${this.bot.game.dimension}. Reach that dimension first.`
                  : `Waiting for ${selected}. ${location.reason ?? "Reached known coordinates; waiting for entity tracking."}`.slice(
                      0,
                      300,
                    );
              if (Date.now() - missingSince >= 30000)
                throw new MinecraftActionError(
                  `Cannot track ${selected}. ${location.reason ?? "Known coordinates were reached but the player is still absent; they may have moved or changed dimension."}`.slice(
                    0,
                    300,
                  ),
                );
            } else {
              this.locator.tracked(selected);
              waypoint = undefined;
              missingSince = undefined;
              if (
                this.config.radius &&
                !inRadius(target.position, this.anchor!, this.config.radius)
              )
                throw new MinecraftActionError(
                  `${selected} is outside the configured ${this.config.radius}-block leash. Set Movement radius to 0 for unrestricted roaming.`,
                );
              if (target !== tracked) {
                tracked = target;
                pathStatus = "searching";
                lastMotion = Date.now();
                lastPosition = this.bot.entity.position.clone();
                // GoalFollow already tracks entity motion. Replacing it every second resets A* and the route.
                followGoal = new goals.GoalFollow(target, 3);
                this.bot.pathfinder.setGoal(followGoal, true);
              }
              const distance = target.position.distanceTo(
                this.bot.entity.position,
              );
              // Pathfinder uses block-grid coordinates; don't label legitimate goal tolerance as stuck.
              const atGoal = followGoal!.isEnd(
                // GoalFollow reads xyz only, as pathfinder's own monitoring loop does.
                this.bot.entity.position.floored() as unknown as Parameters<
                  goals.GoalFollow["isEnd"]
                >[0],
              );
              if (
                atGoal ||
                this.bot.entity.position.distanceTo(lastPosition) >= 0.5
              ) {
                lastMotion = Date.now();
                lastPosition = this.bot.entity.position.clone();
              }
              this.job!.detail = atGoal
                ? `With ${selected}; following when they move.`
                : `Following ${selected}: ${Math.round(distance)} blocks away${pathStatus === "noPath" ? "; no walkable path found" : pathStatus === "timeout" ? "; path search timed out" : ""}.`;
              if (Date.now() - lastMotion >= 20000)
                throw new MinecraftActionError(
                  `Cannot reach ${selected}: no movement for 20 seconds (${Math.round(distance)} blocks away). Try reachable ground or a waypoint; navigation does not dig or place blocks.`,
                );
            }
            this.publish();
            await delay(1000, undefined, { signal });
          }
        } finally {
          this.bot.removeListener("path_update", onPath);
        }
      });
    }
    if (name === "collect_blocks") {
      const { block, count } = z
        .object({
          block: z.string().regex(/^[a-z0-9_]{1,100}$/),
          count: z.number().int().min(1).max(this.config.maxBlocks),
        })
        .strict()
        .parse(raw);
      if (!this.config.modifyBlocks)
        throw new MinecraftActionError("Block modification permission is off.");
      if (!this.bot.registry.blocksByName[block])
        throw new MinecraftActionError("Unknown block ID.");
      if (
        !this.config.freePlay &&
        ![
          "dirt",
          "cobblestone",
          "stone",
          "oak_log",
          "birch_log",
          "spruce_log",
        ].includes(block)
      )
        throw new MinecraftActionError(
          "Enable Free play to collect this material.",
        );
      return this.begin("collect", count, async (signal) => {
        const type = this.bot.registry.blocksByName[block];
        const drop = block === "stone" ? "cobblestone" : block;
        const inventoryCount = () =>
          this.bot.inventory
            .items()
            .filter((i) => this.config.freePlay || i.name === drop)
            .reduce((n, i) => n + i.count, 0);
        for (let i = 0; i < count; i++) {
          this.check(signal);
          const target = this.bot
            .findBlocks({
              matching: type.id,
              maxDistance: Math.min(this.config.radius || 128, 128),
              count: 64,
            })
            .map((p) => this.bot.blockAt(p))
            .find(
              (b) =>
                b &&
                (!this.config.buildRadius ||
                  inRadius(
                    b.position,
                    this.config.buildCenter,
                    this.config.buildRadius,
                  )) &&
                (this.config.freePlay ||
                  b.position.y >= this.bot.entity.position.y) &&
                b.position.distanceTo(this.bot.entity.position) > 1,
            );
          if (!target)
            throw new MinecraftActionError(
              "No safe matching block in approved area.",
            );
          this.area(target.position);
          await this.navigate(target.position, signal, 2);
          this.check(signal);
          const current = this.bot.blockAt(target.position);
          if (
            !current ||
            current.name !== block ||
            !this.bot.canDigBlock(current)
          )
            throw new MinecraftActionError("Block changed or cannot be dug.");
          const above = this.bot.blockAt(target.position.offset(0, 1, 0));
          if (
            !this.config.freePlay &&
            above &&
            ["sand", "gravel", "water", "lava"].some((n) =>
              above.name.includes(n),
            )
          )
            throw new MinecraftActionError("Unsafe block above target.");
          const tool = this.bot.pathfinder.bestHarvestTool(current);
          if (tool) {
            await this.bot.equip(tool, "hand");
            this.check(signal);
          }
          if (!current.canHarvest(this.bot.heldItem?.type ?? null))
            throw new MinecraftActionError(
              "Required harvesting tool is missing.",
            );
          const before = inventoryCount();
          await this.bot.dig(current);
          this.check(signal);
          await this.until(
            () => this.bot.blockAt(target.position)?.name === "air",
            signal,
          );
          await this.navigate(target.position, signal, 0.5);
          await this.until(() => inventoryCount() > before, signal);
          this.job!.progress = i + 1;
          this.publish();
        }
      });
    }
    if (name === "build_blocks") {
      const itemSchema = pointSchema.extend({
        x: pointSchema.shape.x.int(),
        y: pointSchema.shape.y.int(),
        z: pointSchema.shape.z.int(),
        block: z.string().regex(/^[a-z0-9_]{1,100}$/),
      });
      const { blocks } = z
        .object({
          blocks: z
            .array(itemSchema)
            .min(1)
            .max(Math.min(128, this.config.maxBlocks)),
        })
        .strict()
        .parse(raw);
      if (!this.config.modifyBlocks)
        throw new MinecraftActionError("Block modification permission is off.");
      for (const b of blocks) {
        if (
          !this.config.freePlay &&
          ![
            "dirt",
            "cobblestone",
            "stone",
            "oak_planks",
            "birch_planks",
            "spruce_planks",
            "glass",
          ].includes(b.block)
        )
          throw new MinecraftActionError(
            "Enable Free play to build with this material.",
          );
        if (this.config.freePlay && !this.bot.registry.blocksByName[b.block])
          throw new MinecraftActionError("Unknown block ID.");
      }
      if (
        new Set(blocks.map((b) => `${b.x},${b.y},${b.z}`)).size !==
        blocks.length
      )
        throw new MinecraftActionError("Duplicate build positions.");
      for (const b of blocks) this.area(new Vec3(b.x, b.y, b.z));
      return this.begin("build", blocks.length, async (signal) => {
        for (const b of blocks) {
          const pos = new Vec3(b.x, b.y, b.z);
          this.check(signal);
          this.area(pos);
          const existing = this.bot.blockAt(pos);
          if (
            !existing ||
            !["air", "cave_air", "void_air"].includes(existing.name)
          )
            throw new MinecraftActionError(
              "Build location is occupied or unloaded.",
            );
          await this.navigate(pos, signal, 3);
          this.check(signal);
          const item = this.bot.inventory
            .items()
            .find((i) => i.name === b.block);
          if (!item)
            throw new MinecraftActionError("Required block not in inventory.");
          const offsets = [
            new Vec3(0, -1, 0),
            new Vec3(1, 0, 0),
            new Vec3(-1, 0, 0),
            new Vec3(0, 0, 1),
            new Vec3(0, 0, -1),
          ];
          const reference = offsets
            .map((offset) => ({
              block: this.bot.blockAt(pos.plus(offset)),
              face: offset.scaled(-1),
            }))
            .find(
              (r) =>
                r.block?.boundingBox === "block" &&
                (this.config.freePlay ||
                  [
                    "dirt",
                    "grass_block",
                    "stone",
                    "cobblestone",
                    "oak_planks",
                    "birch_planks",
                    "spruce_planks",
                    "glass",
                  ].includes(r.block.name)),
            );
          if (!reference?.block)
            throw new MinecraftActionError("No safe supporting block.");
          await this.bot.equip(item, "hand");
          this.check(signal);
          if (
            !["air", "cave_air", "void_air"].includes(
              this.bot.blockAt(pos)?.name ?? "",
            )
          )
            throw new MinecraftActionError("Build location changed.");
          if (this.config.freePlay) this.bot.setControlState("sneak", true);
          try {
            await this.bot.placeBlock(reference.block, reference.face);
          } finally {
            if (this.config.freePlay) this.bot.setControlState("sneak", false);
          }
          await this.until(
            () => this.bot.blockAt(pos)?.name === b.block,
            signal,
          );
          this.job!.progress++;
          this.publish();
        }
        for (const b of blocks)
          if (this.bot.blockAt(new Vec3(b.x, b.y, b.z))?.name !== b.block)
            throw new MinecraftActionError(
              "Final structure verification failed.",
            );
      });
    }
    throw new MinecraftActionError("Unknown Minecraft tool.");
  }
}
