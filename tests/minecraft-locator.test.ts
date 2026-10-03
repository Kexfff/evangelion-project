import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { Vec3 } from "vec3";
import {
  MinecraftLocator,
  coordinateReply,
} from "../electron/minecraft-locator";

const response = (name: string, text: string) => ({
  json: {
    translate: "commands.data.entity.query",
    with: [{ text: name }, { text }],
  },
});
function fixture(operator = true) {
  const bot: any = new EventEmitter();
  Object.assign(bot, {
    username: "Eva",
    players: { Player: {} },
    game: { dimension: "overworld" },
    chat: vi.fn((command: string) => {
      queueMicrotask(() =>
        bot.emit(
          "message",
          response(
            "Player",
            command.endsWith(" Pos")
              ? "[512.5d, 65.0d, -310.25d]"
              : '"minecraft:overworld"',
          ),
          "system",
        ),
      );
    }),
  });
  return { bot, locator: new MinecraftLocator(bot, operator) };
}
afterEach(() => vi.useRealTimers());
describe("Minecraft coordinate lookup", () => {
  it("does not use operator commands indirectly when lookup requires approval", async () => {
    const { bot, locator } = fixture();
    expect((await locator.locate("Player", undefined, false)).source).toBe(
      "unknown",
    );
    expect(bot.chat).not.toHaveBeenCalled();
    // An explicitly approved direct lookup still works.
    expect((await locator.locate("Player")).source).toBe("operator");
    expect(bot.chat).toHaveBeenCalledTimes(2);
  });
  it("parses 26.1 styled NBT components, including empty-key punctuation fragments", () => {
    const position = response("Player", "");
    Object.assign(position.json.with[1], {
      extra: [
        { "": "[" },
        { text: "512.5", color: "gold" },
        { text: "d" },
        { "": ", " },
        { text: "65.0d" },
        { "": ", " },
        { text: "-310.25d" },
        { "": "]" },
      ],
    });
    expect(coordinateReply(position, "system", "Player", "Pos")).toEqual({
      x: 512.5,
      y: 65,
      z: -310.25,
    });
    const dimension = response("Player", "");
    Object.assign(dimension.json.with[1], {
      extra: [
        { "": '"' },
        { text: "minecraft:overworld", color: "green" },
        { "": '"' },
      ],
    });
    expect(coordinateReply(dimension, "system", "Player", "Dimension")).toBe(
      "overworld",
    );
  });
  it("accepts only typed vanilla system replies matching the requested player", () => {
    expect(
      coordinateReply(
        response("Player", "[1d, 2.5d, -3d]"),
        "system",
        "Player",
        "Pos",
      ),
    ).toEqual({ x: 1, y: 2.5, z: -3 });
    expect(
      coordinateReply(
        response("Player", "[1d, 2d, 3d]"),
        "chat",
        "Player",
        "Pos",
      ),
    ).toBeUndefined();
    expect(
      coordinateReply(
        response("Other", "[1d, 2d, 3d]"),
        "system",
        "Player",
        "Pos",
      ),
    ).toBeUndefined();
    expect(
      coordinateReply(
        response("Player", "[NaNd, 2d, 3d]"),
        "system",
        "Player",
        "Pos",
      ),
    ).toBeUndefined();
  });
  it("reads distant position and dimension with exactly two fixed commands, then caches briefly", async () => {
    const { bot, locator } = fixture();
    expect(await locator.locate("Player")).toMatchObject({
      source: "operator",
      position: { x: 512.5, y: 65, z: -310.25 },
      dimension: "overworld",
    });
    await locator.locate("Player");
    expect(bot.chat.mock.calls).toEqual([
      ["/data get entity Player Pos"],
      ["/data get entity Player Dimension"],
    ]);
    expect(bot.listenerCount("message")).toBe(0);
  });
  it("keeps last-seen coordinates explicitly stale after tracking is lost", async () => {
    const { bot, locator } = fixture(false);
    bot.players.Player.entity = { position: new Vec3(150, 64, 0) };
    expect(locator.locations()[0]).toMatchObject({
      source: "tracking",
      position: { x: 150 },
    });
    bot.players.Player.entity = undefined;
    expect(await locator.locate("Player")).toMatchObject({
      source: "last_seen",
      position: { x: 150 },
    });
    expect(bot.chat).not.toHaveBeenCalled();
  });
  it("does not invent coordinates or send commands when operator lookup is disabled", async () => {
    const { bot, locator } = fixture(false);
    expect(await locator.locate("Player")).toMatchObject({ source: "unknown" });
    expect(bot.chat).not.toHaveBeenCalled();
    await expect(locator.locate("@a run kill")).rejects.toThrow();
  });
  it("fails with actionable guidance on missing operator feedback and cleans up listeners", async () => {
    vi.useFakeTimers();
    const { bot, locator } = fixture();
    bot.chat.mockImplementation(() => {});
    const promise = locator.locate("Player");
    await vi.advanceTimersByTimeAsync(3001);
    expect(await promise).toMatchObject({
      source: "unknown",
      reason: expect.stringContaining("operator permission"),
    });
    expect(bot.listenerCount("message")).toBe(0);
  });
  it("cancels pending coordinate queries on stop", async () => {
    const { bot, locator } = fixture();
    bot.chat.mockImplementation(() => {});
    const promise = locator.locate("Player");
    const rejected = expect(promise).rejects.toThrow();
    locator.cancel();
    await rejected;
    expect(bot.listenerCount("message")).toBe(0);
  });
});
