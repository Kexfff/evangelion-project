import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseMemoryFacts } from "../electron/memory-extraction";
import { OpenAICompatibleProvider } from "../electron/providers";
import { CompanionRuntime } from "../electron/runtime";
import { Store } from "../electron/store";
import { defaultSettings, type RuntimeEvent } from "../src/shared/schema";

const dirs: string[] = [];
const runtimes: CompanionRuntime[] = [];
function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "eva-memory-extraction-"));
  dirs.push(dir);
  const store = new Store(dir);
  store.update((d) => {
    d.settings.memory.autoRemember = true;
  });
  const events: RuntimeEvent[] = [];
  const runtime = new CompanionRuntime(
    store,
    () => "",
    "local-file",
    (e) => events.push(e),
  );
  runtimes.push(runtime);
  const warnings = () =>
    events.filter((e) => e.type === "warning").map((e) => e.message);
  return { runtime, store, events, warnings };
}
function completion(content: string | null, finish_reason = "stop") {
  return new Response(
    JSON.stringify({
      choices: [{ finish_reason, message: { content } }],
      usage: { total_tokens: 42 },
    }),
    { headers: { "Content-Type": "application/json" } },
  );
}
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((r) => r.cancel()));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});

describe("memory response parsing", () => {
  it.each([
    '["The user likes tea."]',
    '  \n```json\n["The user likes tea."]\n```\n  ',
    '{"facts":["The user likes tea."]}',
    'Here is the result:\n```JSON\n{"facts":["The user likes tea."]}\n```',
    '<think>Never save this speculative ["fake fact"].</think>\n{"facts":["The user likes tea."]}',
  ])("accepts complete validated JSON envelopes: %s", (output) => {
    expect(parseMemoryFacts(output)).toEqual(["The user likes tea."]);
  });
  it("handles no facts, blank entries, duplicates and an overlong fact count safely", () => {
    expect(parseMemoryFacts('{"facts":[]}')).toEqual([]);
    expect(parseMemoryFacts('[" A ","a","", "B","C","D"]')).toEqual([
      "A",
      "B",
      "C",
    ]);
  });
  it.each([
    '["An incomplete fact',
    '{"facts":[{"text":"Do not guess object schemas"}]}',
    "No durable facts.",
    "null",
    '```json\n["A"]\n```\n```json\n["B"]\n```',
    '<think>unfinished reasoning\n```json\n["Do not save reasoning"]\n```',
    JSON.stringify(["x".repeat(301)]),
  ])(
    "rejects malformed/ambiguous output without saving arbitrary text: %s",
    (output) => {
      expect(() => parseMemoryFacts(output)).toThrow("valid memory fact list");
    },
  );
});

describe("background extraction recovery", () => {
  it("retries malformed output once, then saves facts without disturbing the chat", async () => {
    const f = setup();
    const request = vi
      .fn()
      .mockResolvedValueOnce(completion("Glad to know!"))
      .mockResolvedValueOnce(completion("Here are facts but this is not JSON."))
      .mockResolvedValueOnce(
        completion(' \n```json\n{"facts":["The user likes tea."]}\n``` '),
      );
    vi.stubGlobal("fetch", request);
    await f.runtime.send("I like tea.");
    await vi.waitFor(() => expect(f.store.data.facts).toHaveLength(1));
    expect(f.store.data.messages.map((m) => m.content)).toEqual([
      "I like tea.",
      "Glad to know!",
    ]);
    expect(f.warnings()).toEqual([]);
    expect(request).toHaveBeenCalledTimes(3);
    const bodies = request.mock.calls.map((args) => JSON.parse(args[1].body));
    expect(bodies[0]).toMatchObject({ temperature: 0.8, max_tokens: 700 });
    expect(bodies[0].reasoning).toBeUndefined();
    expect(bodies[1]).toMatchObject({
      temperature: 0.1,
      max_tokens: 2048,
      stream: false,
      reasoning: { enabled: false },
    });
    expect(bodies[2]).toMatchObject({ max_tokens: 4096 });
    expect(JSON.stringify(bodies[2].messages)).not.toContain(
      "Here are facts but",
    );
    expect(
      f.store.data.automation.activity.filter(
        (e) => e.kind === "memory-request",
      ),
    ).toHaveLength(2);
  });
  it("recognizes token exhaustion even with empty content and recovers with the larger budget", async () => {
    const f = setup();
    const request = vi
      .fn()
      .mockResolvedValueOnce(completion("Hello!"))
      .mockResolvedValueOnce(completion(null, "length"))
      .mockResolvedValueOnce(completion('["The user likes tea."]'));
    vi.stubGlobal("fetch", request);
    await f.runtime.send("I like tea.");
    await vi.waitFor(() => expect(f.store.data.facts).toHaveLength(1));
    expect(f.warnings()).toEqual([]);
    expect(
      f.store.data.automation.activity.filter((e) => e.kind === "memory-usage"),
    ).toHaveLength(2);
  });
  it("logs a useful redacted failure after two unusable responses, never inventing facts", async () => {
    const f = setup();
    const request = vi
      .fn()
      .mockResolvedValueOnce(completion("Reply saved"))
      .mockResolvedValueOnce(completion("secret-output"))
      .mockResolvedValueOnce(completion("secret-output"));
    vi.stubGlobal("fetch", request);
    await f.runtime.send("Remember tea");
    await vi.waitFor(() => expect(f.warnings()).toHaveLength(1));
    expect(request).toHaveBeenCalledTimes(3);
    expect(f.warnings()[0]).toContain("invalid fact list after one retry");
    expect(f.store.data.facts).toHaveLength(0);
    expect(f.store.data.messages).toHaveLength(2);
    expect(JSON.stringify(f.events)).not.toContain("secret-output");
    expect(
      f.store.data.automation.activity.some((e) => e.kind === "memory-failed"),
    ).toBe(true);
  });
  it("reports HTTP status without retrying quota/auth failures or exposing response bodies", async () => {
    const f = setup();
    const request = vi
      .fn()
      .mockResolvedValueOnce(completion("Reply saved"))
      .mockResolvedValueOnce(
        new Response("Authorization: secret", { status: 429 }),
      );
    vi.stubGlobal("fetch", request);
    await f.runtime.send("I like tea.");
    await vi.waitFor(() => expect(f.warnings()).toHaveLength(1));
    expect(f.warnings()[0]).toContain("HTTP 429");
    expect(JSON.stringify(f.events)).not.toContain("Authorization: secret");
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("does not force OpenRouter-only options on a local compatible server", async () => {
    const request = vi.fn().mockResolvedValue(completion('{"facts":[]}'));
    vi.stubGlobal("fetch", request);
    await new OpenAICompatibleProvider().chat(
      { ...defaultSettings.providers.llm, baseUrl: "http://localhost:8000/v1" },
      "",
      [],
      () => {},
      undefined,
      false,
      undefined,
      { disableReasoning: true, maxTokens: 2048, requireComplete: true },
    );
    expect(JSON.parse(request.mock.calls[0][1].body).reasoning).toBeUndefined();
  });
  it("never stores valid-looking partial output marked as truncated", async () => {
    const f = setup();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(completion("Reply saved"))
        .mockResolvedValueOnce(completion('["Partial fact"]', "length"))
        .mockResolvedValueOnce(completion('["Partial fact"]', "length")),
    );
    await f.runtime.send("I like tea.");
    await vi.waitFor(() => expect(f.warnings()).toHaveLength(1));
    expect(f.warnings()[0]).toContain("token budget");
    expect(f.store.data.facts).toHaveLength(0);
  });
  it("cancellation suppresses warnings and prevents a format retry", async () => {
    const f = setup();
    let resolve!: (value: string) => void;
    const chat = vi
      .spyOn(f.runtime.provider, "chat")
      .mockResolvedValueOnce("Hello")
      .mockImplementationOnce(
        () =>
          new Promise<string>((r) => {
            resolve = r;
          }),
      );
    await f.runtime.send("Tea please");
    await f.runtime.cancel();
    resolve("not JSON");
    // Wait for the cancelled background operation's cleanup, not just the chat turn.
    await vi.waitFor(() => expect(f.runtime["extraction"]).toBeUndefined());
    expect(chat).toHaveBeenCalledTimes(2);
    expect(f.warnings()).toEqual([]);
    expect(f.store.data.facts).toHaveLength(0);
  });
  it("does not retry or restore facts after the source message is deleted", async () => {
    const f = setup();
    let resolve!: (value: string) => void;
    const chat = vi
      .spyOn(f.runtime.provider, "chat")
      .mockResolvedValueOnce("Hello")
      .mockImplementationOnce(
        () =>
          new Promise<string>((r) => {
            resolve = r;
          }),
      );
    await f.runtime.send("Tea please");
    f.store.update((d) => {
      d.messages = [];
    });
    resolve("invalid JSON");
    await vi.waitFor(() => expect(f.runtime["extraction"]).toBeUndefined());
    expect(chat).toHaveBeenCalledTimes(2);
    expect(f.warnings()).toEqual([]);
    expect(f.store.data.facts).toHaveLength(0);
  });
});
