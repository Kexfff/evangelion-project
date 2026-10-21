import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  activityExport,
  activityFailure,
  activityPage,
} from "../electron/activity-log";
import { ProviderChatError, consumeSSE } from "../electron/providers";
import { activitySchema, type Activity } from "../src/shared/autonomy";

const entries = (count: number): Activity[] =>
  Array.from({ length: count }, (_, n) => ({
    id: randomUUID(),
    characterId: n % 2 ? "other" : "eva",
    at: new Date(n).toISOString(),
    kind: "policy",
    detail: `Event ${n}`,
    requests: 0,
  }));
describe("activity diagnostics and export", () => {
  it("pages newest first by character and cursor without duplicates when events arrive", () => {
    const all = entries(45);
    const first = activityPage(all, "eva");
    expect(first.entries).toHaveLength(10);
    expect(first.total).toBe(23);
    expect(first.entries[0].detail).toBe("Event 44");
    all.push({ ...entries(1)[0], detail: "New arrival" });
    const second = activityPage(all, "eva", first.entries.at(-1)!.id);
    expect(second.entries).toHaveLength(10);
    expect(second.entries[0].detail).toBe("Event 24");
    const third = activityPage(all, "eva", second.entries.at(-1)!.id);
    expect(third.entries).toHaveLength(3);
    expect(third.hasMore).toBe(false);
    expect(activityPage(all, "eva", randomUUID()).entries).toEqual([]);
    expect(activityPage(all, "missing")).toEqual({
      entries: [],
      total: 0,
      hasMore: false,
    });
  });
  it("exports all retained characters, preserves old entries and strips unknown fields", () => {
    const all = entries(500);
    Object.assign(all[0], { apiKey: "must-not-export" });
    const dump = activityExport(all, "test", "linux", "x64");
    expect(dump.entries).toHaveLength(500);
    expect(new Set(dump.entries.map((e) => e.characterId)).size).toBe(2);
    expect(JSON.stringify(dump)).not.toContain("must-not-export");
    expect(activitySchema.parse(all[1]).diagnostic).toBeUndefined();
    expect(activityExport([], "test", "linux", "x64").entries).toEqual([]);
  });
  it("reports categories and whitelisted codes, never raw messages, stacks or nested causes", () => {
    const secret =
      "private prompt sk-secret https://private.example/?token=secret";
    const errors = [
      new ProviderChatError("http", secret, 400),
      new Error(secret, { cause: { code: "ECONNREFUSED", message: secret } }),
      new DOMException(secret, "TimeoutError"),
      new SyntaxError(secret),
      new Error(secret, { cause: { code: secret } }),
    ];
    const results = errors.map((e) => activityFailure(e));
    expect(results.map((r) => r.errorCategory)).toEqual([
      "http",
      "transport",
      "timeout",
      "invalid-response",
      "internal",
    ]);
    expect(results[0]).toMatchObject({ httpStatus: 400 });
    expect(results[1]).toMatchObject({ transportCode: "ECONNREFUSED" });
    expect(activityFailure(errors[0], true).errorCategory).toBe("cancelled");
    expect(JSON.stringify(results)).not.toContain("secret");
    expect(JSON.stringify(results)).not.toContain("private");
  });
  it("classifies SSE errors and premature/empty streams without exposing upstream text", async () => {
    const failure = async (body: string) => {
      try {
        await consumeSSE(new Response(body).body!, () => {});
      } catch (error) {
        return activityFailure(error);
      }
    };
    expect(
      await failure('data: {"error":{"code":400,"message":"secret"}}\n\n'),
    ).toMatchObject({ errorCategory: "stream-error", httpStatus: 400 });
    expect(
      await failure('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'),
    ).toMatchObject({ errorCategory: "truncated" });
    expect(await failure("data: [DONE]\n\n")).toMatchObject({
      errorCategory: "empty",
    });
    expect(await failure("data: not-json\n\n")).toMatchObject({
      errorCategory: "invalid-response",
    });
  });
});
