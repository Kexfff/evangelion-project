import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../electron/store";
import { buildContext } from "../electron/memory";
import { CompanionRuntime } from "../electron/runtime";
import {
  consumeSSE,
  endpoint,
  OpenAICompatibleProvider,
} from "../electron/providers";
import {
  defaultSettings,
  memoryExportSchema,
  settingsSchema,
  type RuntimeEvent,
} from "../src/shared/schema";

const directories: string[] = [];
function makeStore() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "eva-test-"));
  directories.push(dir);
  return new Store(dir);
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true });
});
const now = "2026-09-08T12:00:00.000Z";
describe("persistence and character memory", () => {
  it("includes full-archive statistics even when the live session snapshot is empty", () => {
    const store = makeStore();
    store.update((d) => {
      d.messages.push({
        id: "archived",
        characterId: "eva",
        sessionId: "previous-session",
        role: "user",
        content: "An earlier conversation",
        createdAt: now,
      });
      d.messages.push({
        id: "foreign",
        characterId: "other",
        sessionId: "foreign",
        role: "user",
        content: "Private",
        createdAt: now,
      });
    });
    expect(store.snapshot("local-file", false).messages).toHaveLength(0);
    expect(store.snapshot("local-file", false).historyStats).toEqual({
      conversations: 1,
      messages: 1,
      images: 0,
    });
    store.update((d) => {
      d.messages = [];
    });
    expect(store.snapshot("local-file", false).historyStats).toEqual({
      conversations: 0,
      messages: 0,
      images: 0,
    });
  });
  it("persists settings, session, facts and conversations across a restart", () => {
    const store = makeStore();
    store.update((d) => {
      d.facts.push({
        id: "f1",
        characterId: "eva",
        text: "Loves Minecraft",
        source: "manual",
        createdAt: now,
        updatedAt: now,
      });
      d.messages.push({
        id: "m1",
        characterId: "eva",
        sessionId: store.sessionId,
        role: "user",
        content: "Hello",
        createdAt: now,
      });
    });
    const reopened = new Store(path.dirname(store.file));
    expect(reopened.data).toEqual(store.data);
    expect(JSON.parse(readFileSync(`${store.file}.bak`, "utf8")).facts).toEqual(
      [],
    );
  });
  it("does not commit invalid settings or mutate the previous database", () => {
    const store = makeStore();
    expect(() =>
      store.update((d) => {
        d.settings.vrm.zoom = 100;
      }),
    ).toThrow();
    expect(store.data.settings.vrm.zoom).toBe(1);
    expect(
      settingsSchema.safeParse({
        ...defaultSettings,
        activeCharacterId: "missing",
      }).success,
    ).toBe(false);
  });
  it("retrieves relevant old conversations and isolates characters", () => {
    const store = makeStore();
    store.update((d) => {
      d.messages = [
        {
          id: "old",
          characterId: "eva",
          sessionId: "old-session",
          role: "user",
          content: "My Minecraft house is made of cherry wood.",
          createdAt: now,
        },
        {
          id: "secret",
          characterId: "other",
          sessionId: "old-session",
          role: "user",
          content: "Minecraft SECRET",
          createdAt: now,
        },
        {
          id: "new",
          characterId: "eva",
          sessionId: store.sessionId,
          role: "user",
          content: "Remember my Minecraft house?",
          createdAt: now,
        },
      ];
      d.facts.push({
        id: "other-fact",
        characterId: "other",
        text: "PRIVATE FACT",
        source: "manual",
        createdAt: now,
        updatedAt: now,
      });
    });
    const context = buildContext(store.data, "Minecraft house");
    expect(context[0].content).toContain("cherry wood");
    expect(JSON.stringify(context)).not.toContain("SECRET");
    expect(JSON.stringify(context)).not.toContain("PRIVATE FACT");
    expect(context.at(-1)?.content).toBe("Remember my Minecraft house?");
  });
  it("bounds the current context and validates imports", () => {
    const store = makeStore();
    store.update((d) => {
      for (let i = 0; i < 30; i++)
        d.messages.push({
          id: `${i}`,
          characterId: "eva",
          sessionId: store.sessionId,
          role: i % 2 ? "assistant" : "user",
          content: "x".repeat(8000),
          createdAt: now,
        });
    });
    expect(
      buildContext(store.data, "hello")
        .slice(1)
        .reduce((n, m) => n + m.content.length, 0),
    ).toBeLessThanOrEqual(24000);
    expect(
      memoryExportSchema.safeParse({ version: 99, facts: [], messages: [] })
        .success,
    ).toBe(false);
    expect(
      memoryExportSchema.safeParse({
        version: 1,
        facts: [{ text: "incomplete" }],
        messages: [],
      }).success,
    ).toBe(false);
  });
});
describe("OpenAI-compatible protocols", () => {
  it("parses arbitrary UTF-8 chunk boundaries, comments, CRLF, and completion", async () => {
    const text =
      ': heartbeat\r\ndata: {"choices":[{"delta":{"content":"Привет"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":" Eva"}}]}\n\ndata: [DONE]\n\n';
    const bytes = new TextEncoder().encode(text);
    const chunks: string[] = [];
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (const byte of bytes) c.enqueue(new Uint8Array([byte]));
        c.close();
      },
    });
    expect(await consumeSSE(stream, (t) => chunks.push(t))).toBe("Привет Eva");
    expect(chunks).toEqual(["Привет", " Eva"]);
  });
  it("rejects truncated streams and upstream errors", async () => {
    await expect(
      consumeSSE(
        new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n')
          .body!,
        () => {},
      ),
    ).rejects.toThrow("unexpectedly");
    await expect(
      consumeSSE(
        new Response('data: {"error":{"message":"secret"}}\n').body!,
        () => {},
      ),
    ).rejects.toThrow("streaming error");
  });
  it("uses bearer auth, the requested model, and the correct chat route", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: "Hello" } }] }),
          { headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetch);
    const adapter = new OpenAICompatibleProvider();
    expect(
      await adapter.chat(
        defaultSettings.providers.llm,
        "test-key",
        [{ role: "user", content: "Hi" }],
        () => {},
      ),
    ).toBe("Hello");
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer test-key");
    expect(JSON.parse(init.body).model).toBe("openrouter/auto");
    expect(endpoint("http://localhost:8000/v1/", "audio/speech")).toBe(
      "http://localhost:8000/v1/audio/speech",
    );
  });
  it("uploads multipart ASR and requests binary MP3 speech", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"text":"hello there"}'))
      .mockResolvedValueOnce(
        new Response(new Uint8Array([73, 68, 51]), {
          headers: { "Content-Type": "audio/mpeg" },
        }),
      );
    vi.stubGlobal("fetch", fetch);
    const adapter = new OpenAICompatibleProvider();
    expect(
      await adapter.transcribe(
        { ...defaultSettings.providers.asr, enabled: true },
        "",
        new Uint8Array([1, 2]).buffer,
        "audio/webm",
        "en",
      ),
    ).toBe("hello there");
    const form = fetch.mock.calls[0][1].body as FormData;
    expect(form.get("model")).toBe("whisper-1");
    expect(form.get("language")).toBe("en");
    expect((form.get("file") as File).name).toBe("recording.webm");
    expect(fetch.mock.calls[0][1].headers["Content-Type"]).toBeUndefined();
    expect(
      (
        await adapter.speak(
          { ...defaultSettings.providers.tts, enabled: true },
          "",
          "Hello",
          1.2,
        )
      ).byteLength,
    ).toBe(3);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({
      input: "Hello",
      speed: 1.2,
      response_format: "mp3",
      voice: "alloy",
    });
  });
  it("redacts upstream error bodies and rejects unsafe base URLs", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("Authorization: secret", { status: 401 }),
        ),
    );
    await expect(
      new OpenAICompatibleProvider().chat(
        defaultSettings.providers.llm,
        "secret",
        [],
        () => {},
      ),
    ).rejects.toThrow("HTTP 401");
    const s = structuredClone(defaultSettings);
    s.providers.llm.baseUrl = "file:///etc/passwd";
    expect(settingsSchema.safeParse(s).success).toBe(false);
  });
});
describe("conversation lifecycle", () => {
  it("automatically extracts explicit facts and avoids duplicates", async () => {
    const store = makeStore();
    store.update((d) => {
      d.settings.memory.autoRemember = true;
    });
    const runtime = new CompanionRuntime(
      store,
      () => "",
      "session-only",
      () => {},
    );
    vi.spyOn(runtime.provider, "chat").mockImplementation(
      async (_p, _k, _m, delta, _signal, stream = true) => {
        if (!stream)
          return '["The user likes Minecraft.","The user likes Minecraft."]';
        delta("That sounds fun.");
        return "That sounds fun.";
      },
    );
    await runtime.send("I like Minecraft.");
    await vi.waitFor(() => expect(store.data.facts).toHaveLength(1));
    expect(store.data.facts[0]).toMatchObject({
      characterId: "eva",
      source: "conversation",
      text: "The user likes Minecraft.",
    });
  });
  it("streams a reply, saves it once, and emits a final idle snapshot", async () => {
    const store = makeStore();
    const events: RuntimeEvent[] = [];
    const runtime = new CompanionRuntime(
      store,
      () => "",
      "session-only",
      (e) => events.push(e),
    );
    vi.spyOn(runtime.provider, "chat").mockImplementation(
      async (_p, _k, _m, delta) => {
        delta("Hello");
        return "Hello";
      },
    );
    await runtime.send("Hi");
    expect(store.data.messages.map((m) => m.content)).toEqual(["Hi", "Hello"]);
    expect(runtime.busy).toBe(false);
    expect(events).toContainEqual({ type: "delta", text: "Hello" });
    expect(events.at(-1)?.type).toBe("state");
  });
  it("cancels an in-flight turn without persisting a partial assistant reply", async () => {
    const store = makeStore();
    const runtime = new CompanionRuntime(
      store,
      () => "",
      "session-only",
      () => {},
    );
    vi.spyOn(runtime.provider, "chat").mockImplementation(
      (_p, _k, _m, delta, signal) =>
        new Promise((_resolve, reject) => {
          delta("Partial");
          signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
    );
    const send = runtime.send("Hi");
    await expect(runtime.send("duplicate")).rejects.toThrow("already");
    runtime.cancel();
    await expect(send).rejects.toThrow("aborted");
    expect(store.data.messages.map((m) => m.role)).toEqual(["user"]);
    expect(runtime.busy).toBe(false);
  });
  it("retains user input after a provider failure", async () => {
    const store = makeStore();
    const runtime = new CompanionRuntime(
      store,
      () => "",
      "session-only",
      () => {},
    );
    vi.spyOn(runtime.provider, "chat").mockRejectedValue(new Error("offline"));
    await expect(runtime.send("Please remember this")).rejects.toThrow(
      "offline",
    );
    expect(store.data.messages).toHaveLength(1);
    expect(runtime.busy).toBe(false);
  });
});
