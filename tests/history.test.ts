import { describe, expect, it } from "vitest";
import {
  assertHistoryCharacter,
  conversationQuerySchema,
  historyImageQuerySchema,
  historyQuerySchema,
  historyTotals,
  listHistory,
  readConversation,
  readHistoryImage,
} from "../src/shared/history";
import type { Message } from "../src/shared/schema";

const image = {
  name: "garden.png",
  dataUrl: "data:image/png;base64,iVBORw0KGgo=",
};
const message = (i: number, patch: Partial<Message> = {}): Message => ({
  id: `m${i}`,
  characterId: "eva",
  sessionId: "old",
  role: "user",
  content: `Message ${i}`,
  createdAt: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString(),
  ...patch,
});
const query = historyQuerySchema.parse({ characterId: "eva" });
describe("read-only conversation archive", () => {
  it("counts all saved sessions, both roles and images across channels without including other characters", () => {
    const messages = Array.from({ length: 245 }, (_, i) =>
      message(i, {
        sessionId: i < 200 ? "older" : "current",
        role: i % 2 ? "assistant" : "user",
        channel: i % 3 ? "desktop" : "telegram",
        images: i === 0 ? [image, image] : undefined,
      }),
    );
    messages.push(
      message(999, {
        characterId: "other",
        sessionId: "foreign",
        images: [image],
      }),
    );
    const before = structuredClone(messages);
    expect(historyTotals(messages, "eva")).toEqual({
      conversations: 2,
      messages: 245,
      images: 2,
    });
    expect(historyTotals(messages, "missing")).toEqual({
      conversations: 0,
      messages: 0,
      images: 0,
    });
    expect(messages).toEqual(before);
  });
  it("includes old sessions, separates characters and marks only the active chat", () => {
    const messages = [
      message(0),
      message(1, { characterId: "other", content: "SECRET" }),
      message(2, { sessionId: "current", role: "assistant", content: "Hello" }),
    ];
    const before = structuredClone(messages);
    const result = listHistory(messages, "current", query);
    expect(result.totalMessages).toBe(2);
    expect(result.totalSessions).toBe(2);
    expect(result.sessions.map((s) => [s.id, s.current])).toEqual([
      ["current", true],
      ["old", false],
    ]);
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(messages).toEqual(before);
  });
  it("searches both roles and attachment names without returning image bytes", () => {
    const messages = [
      message(0, { content: "", images: [image] }),
      message(1, {
        role: "assistant",
        content: "The flowers look nice",
        channel: "telegram",
      }),
    ];
    expect(
      listHistory(messages, "current", { ...query, search: "FLOWERS" })
        .sessions[0].matches,
    ).toBe(1);
    const result = listHistory(messages, "current", {
      ...query,
      search: "garden",
    });
    expect(result.sessions[0].title).toBe("Shared an image");
    expect(result.sessions[0].channels).toEqual(["desktop", "telegram"]);
    expect(result.sessions[0].images).toBe(1);
    expect(JSON.stringify(result)).not.toContain("data:image");
    const read = readConversation(messages, { ...query, sessionId: "old" });
    expect(read.messages[0].images).toEqual([{ name: "garden.png" }]);
    expect(JSON.stringify(read)).not.toContain("data:image");
  });
  it("filters channels per message, treats legacy messages as desktop and returns no matches cleanly", () => {
    const messages = [message(0), message(1, { channel: "telegram" })];
    expect(
      readConversation(messages, {
        ...query,
        sessionId: "old",
        channel: "desktop",
      }).messages.map((m) => m.id),
    ).toEqual(["m0"]);
    expect(
      readConversation(messages, {
        ...query,
        sessionId: "old",
        channel: "telegram",
      }).total,
    ).toBe(1);
    const result = listHistory(messages, "current", {
      ...query,
      search: "no matches",
    });
    expect(result.sessions).toEqual([]);
    expect(result.totalMessages).toBe(2);
  });
  it("paginates sessions and messages beyond the live snapshot's 200-message limit", () => {
    const messages = Array.from({ length: 245 }, (_, i) => message(i));
    const page = readConversation(messages, {
      ...query,
      sessionId: "old",
      offset: 220,
    });
    expect(page.total).toBe(245);
    expect(page.messages).toHaveLength(20);
    expect(page.messages[0].id).toBe("m220");
    const sessions = messages.map((m, i) => ({ ...m, sessionId: `s${i}` }));
    expect(listHistory(sessions, "s0", query).sessions).toHaveLength(20);
    expect(
      listHistory(sessions, "s0", { ...query, offset: 240 }).sessions,
    ).toHaveLength(5);
  });
  it("keeps same-timestamp ordering stable and orders imported timestamps chronologically", () => {
    const messages = [
      message(0, { createdAt: "2026-09-02T01:00:00+03:00" }),
      message(1, { createdAt: "2026-09-01T23:00:00Z" }),
      message(2, { createdAt: "2026-09-01T23:00:00Z" }),
    ];
    expect(
      readConversation(messages.reverse(), {
        ...query,
        sessionId: "old",
      }).messages.map((m) => m.id),
    ).toEqual(["m0", "m2", "m1"]);
  });
  it("loads only an explicitly requested attachment scoped by character, session and message", () => {
    const messages = [message(0, { images: [image] })];
    const q = {
      characterId: "eva",
      sessionId: "old",
      messageId: "m0",
      index: 0,
    };
    expect(readHistoryImage(messages, q)).toEqual(image);
    for (const patch of [
      { characterId: "other" },
      { sessionId: "foreign" },
      { messageId: "other" },
      { index: 1 },
    ])
      expect(() => readHistoryImage(messages, { ...q, ...patch })).toThrow(
        "no longer available",
      );
  });
  it("validates IPC bounds and rejects stale character requests", () => {
    for (const patch of [
      { offset: -1 },
      { offset: 100001 },
      { offset: 0.5 },
      { search: "x".repeat(201) },
      { channel: "unknown" },
      { extra: true },
    ])
      expect(
        historyQuerySchema.safeParse({ characterId: "eva", ...patch }).success,
      ).toBe(false);
    expect(
      conversationQuerySchema.safeParse({
        characterId: "eva",
        sessionId: "x".repeat(101),
      }).success,
    ).toBe(false);
    expect(
      historyImageQuerySchema.safeParse({
        characterId: "eva",
        sessionId: "old",
        messageId: "m0",
        index: 4,
      }).success,
    ).toBe(false);
    expect(() => assertHistoryCharacter("other", "eva")).toThrow(
      "active character changed",
    );
    expect(() => assertHistoryCharacter("eva", "eva")).not.toThrow();
  });
});
