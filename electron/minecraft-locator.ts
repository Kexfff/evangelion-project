import type { Bot } from "mineflayer";
import { pointSchema } from "../src/shared/minecraft";

export interface PlayerLocation {
  name: string;
  source: "tracking" | "operator" | "last_seen" | "unknown";
  position?: { x: number; y: number; z: number };
  dimension?: string;
  observedAt?: string;
  reason?: string;
}
function plain(value: unknown, depth = 0, budget = { nodes: 128 }): string {
  if (--budget.nodes < 0 || depth > 8) return "";
  if (typeof value === "string") return value.slice(0, 2048);
  if (!value || typeof value !== "object") return "";
  const part = value as { text?: unknown; extra?: unknown[]; ""?: unknown };
  const text =
    typeof part.text === "string"
      ? part.text
      : typeof part[""] === "string"
        ? part[""]
        : "";
  return (
    text +
    (Array.isArray(part.extra)
      ? part.extra
          .slice(0, 64)
          .map((child) => plain(child, depth + 1, budget))
          .join("")
      : "")
  ).slice(0, 2048);
}
// Only accept structured vanilla command feedback, never a player's similarly worded chat.
export function coordinateReply(
  message: any,
  position: string,
  player: string,
  field: "Pos" | "Dimension",
) {
  const json = message?.json ?? message;
  if (
    position !== "system" ||
    json?.translate !== "commands.data.entity.query" ||
    plain(json.with?.[0]) !== player
  )
    return;
  const text = plain(json.with?.[1]);
  if (field === "Dimension") {
    const match = /^"minecraft:(overworld|the_nether|the_end)"$/.exec(
      text.trim(),
    );
    return match?.[1];
  }
  const number = "([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?)";
  const match = new RegExp(
    `^\\[\\s*${number}[dDfF]?\\s*,\\s*${number}[dDfF]?\\s*,\\s*${number}[dDfF]?\\s*\\]$`,
  ).exec(text.trim());
  if (!match) return;
  const point = pointSchema.safeParse({
    x: Number(match[1]),
    y: Number(match[2]),
    z: Number(match[3]),
  });
  return point.success ? point.data : undefined;
}

export class MinecraftLocator {
  private seen = new Map<string, PlayerLocation>();
  private pending?: AbortController;
  constructor(
    private bot: Bot,
    private operator: boolean,
  ) {}
  cancel() {
    this.pending?.abort();
  }
  setOperatorEnabled(enabled: boolean) {
    if (this.operator !== enabled) this.cancel();
    this.operator = enabled;
  }
  tracked(name: string): PlayerLocation | undefined {
    const entity = this.bot.players[name]?.entity;
    if (!entity) return;
    const point = entity.position;
    const location: PlayerLocation = {
      name,
      source: "tracking",
      position: { x: point.x, y: point.y, z: point.z },
      dimension: this.bot.game.dimension,
      observedAt: new Date().toISOString(),
    };
    this.remember(location);
    return location;
  }
  private remember(location: PlayerLocation) {
    this.seen.delete(location.name);
    this.seen.set(location.name, location);
    if (this.seen.size > 100) this.seen.delete(this.seen.keys().next().value!);
  }
  locations() {
    return Object.keys(this.bot.players)
      .filter((name) => name !== this.bot.username)
      .slice(0, 100)
      .map((name) => this.tracked(name) ?? this.previous(name));
  }
  private previous(name: string, reason?: string): PlayerLocation {
    const old = this.seen.get(name);
    if (
      !reason &&
      old?.source === "operator" &&
      Date.now() - Date.parse(old.observedAt!) < 5000
    )
      return old;
    return old
      ? { ...old, source: "last_seen", reason }
      : {
          name,
          source: "unknown",
          reason:
            reason ??
            "Outside entity tracking range; no coordinates observed yet.",
        };
  }
  async locate(
    name: string,
    signal?: AbortSignal,
    allowOperator = true,
  ): Promise<PlayerLocation> {
    if (!/^[a-zA-Z0-9_]{1,16}$/.test(name))
      throw new Error(
        "Use a Minecraft player name, not a selector or command.",
      );
    signal?.throwIfAborted();
    const tracked = this.tracked(name);
    if (tracked) return tracked;
    if (!this.operator || !allowOperator)
      return this.previous(
        name,
        !allowOperator
          ? "Automatic coordinate lookup is blocked or requires approval. Ask for a location lookup or provide a waypoint."
          : "Enable operator coordinate lookup for fresh distant positions, or provide a waypoint.",
      );
    const cached = this.seen.get(name);
    if (
      cached?.source === "operator" &&
      Date.now() - Date.parse(cached.observedAt!) < 5000
    )
      return cached;
    if (this.pending)
      return this.previous(
        name,
        "Another coordinate lookup is in progress; try again shortly.",
      );
    const control = new AbortController();
    this.pending = control;
    const combined = signal
      ? AbortSignal.any([signal, control.signal])
      : control.signal;
    try {
      const position = await this.query(name, "Pos", combined);
      const dimension = await this.query(name, "Dimension", combined);
      if (typeof position === "string" || typeof dimension !== "string")
        throw new Error("Invalid coordinate response.");
      const location: PlayerLocation = {
        name,
        source: "operator",
        position,
        dimension,
        observedAt: new Date().toISOString(),
      };
      this.remember(location);
      return location;
    } catch {
      combined.throwIfAborted();
      return this.previous(
        name,
        "Server did not return coordinates. Enable LAN cheats, grant Eva operator permission, and check the player is online. No tracking-range setting can replace that permission.",
      );
    } finally {
      if (this.pending === control) this.pending = undefined;
    }
  }
  private query(
    name: string,
    field: "Pos" | "Dimension",
    signal: AbortSignal,
  ): Promise<NonNullable<ReturnType<typeof coordinateReply>>> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.bot.removeListener("message", onMessage);
        signal.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        cleanup();
        reject(new Error("Coordinate lookup stopped."));
      };
      const onMessage = (message: unknown, position: string) => {
        const result = coordinateReply(message, position, name, field);
        if (result === undefined) return;
        cleanup();
        resolve(result);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Coordinate lookup timed out."));
      }, 3000);
      this.bot.on("message", onMessage);
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
        return;
      }
      // Fixed read-only commands only. This option does not grant arbitrary operator commands.
      try {
        this.bot.chat(`/data get entity ${name} ${field}`);
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }
}
