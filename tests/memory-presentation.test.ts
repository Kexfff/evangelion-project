import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { Store } from "../electron/store";
import { memoryDocuments } from "../electron/memory-library";
import { retrieveMemory, buildContext } from "../electron/memory";
import { encryptArchive, decryptArchive } from "../electron/memory-archive";
import { projectEmbeddings } from "../src/shared/memory-tools";
import { consumeTranscription } from "../electron/transcription-stream";
import { OpenAICompatibleProvider } from "../electron/providers";
import { defaultSettings } from "../src/shared/schema";
import { cardAvatar, characterCardSchema } from "../electron/character-card";
import { visemeAt, selectGesture } from "../src/audio/visemes";
import { consolidateMemory } from "../electron/consolidation";
import { CompanionRuntime } from "../electron/runtime";
import { SemanticMemory } from "../electron/semantic-memory";
const stores: Store[] = [],
  dirs: string[] = [];
const now = "2026-10-01T12:00:00.000Z";
const image = {
  name: "cottage.png",
  dataUrl:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7ioAAAAASUVORK5CYII=",
};
function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "eva-memory-"));
  dirs.push(dir);
  const s = new Store(dir);
  stores.push(s);
  return s;
}
afterEach(() => {
  vi.unstubAllGlobals();
  for (const s of stores.splice(0)) s.library.sql.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true });
});
describe("memory library", () => {
  it("discards malformed derived vectors without discarding source memories or preventing startup", () => {
    const s = setup();
    s.library.sql
      .prepare("INSERT INTO vectors VALUES (?, ?, ?, ?)")
      .run("bad", "namespace", "hash", "not JSON");
    expect(
      () => new SemanticMemory(s, new OpenAICompatibleProvider(), () => ""),
    ).not.toThrow();
    expect(s.library.sql.prepare("SELECT * FROM vectors").all()).toEqual([]);
  });
  it("cancels semantic inspection through the shared runtime and rejects overlapping work", async () => {
    const s = setup(),
      runtime = new CompanionRuntime(
        s,
        () => "",
        "local-file",
        () => {},
      );
    let received: AbortSignal | undefined;
    vi.spyOn(runtime.semantic, "recall").mockImplementation(
      async (_query, signal) => {
        received = signal;
        return new Promise((_resolve, reject) =>
          signal!.addEventListener("abort", () => reject(signal!.reason), {
            once: true,
          }),
        );
      },
    );
    const pending = runtime.inspectMemory("cottage", true);
    const cancelled = expect(pending).rejects.toThrow();
    await expect(runtime.reindexMemory()).rejects.toThrow(
      "Wait for the current operation",
    );
    await runtime.cancel();
    await cancelled;
    expect(received?.aborted).toBe(true);
    expect(await runtime.inspectMemory("cottage", false)).toEqual([]);
  });
  it("does not recall summaries overlapping the active short-term context", () => {
    const s = setup();
    s.update((d) => {
      d.messages = Array.from({ length: 12 }, (_, i) => ({
        id: `active-${i}`,
        characterId: "eva",
        sessionId: s.sessionId,
        role: i % 2 ? "assistant" : "user",
        content: "cottage plan",
        createdAt: now,
      }));
    });
    expect(retrieveMemory(s.data, "cottage")).toEqual([]);
  });
  it("consolidates on explicit request without deleting sources and invalidates summaries on source deletion", async () => {
    const s = setup();
    s.update((d) => {
      d.messages.push({
        id: "m",
        characterId: "eva",
        sessionId: "older",
        role: "user",
        content: "I planned a cottage",
        createdAt: now,
      });
    });
    const provider = new OpenAICompatibleProvider();
    const chat = vi
      .spyOn(provider, "chat")
      .mockResolvedValue('{"summary":"User planned a cottage."}');
    expect(
      await consolidateMemory(s, provider, "", new AbortController().signal),
    ).toContain("1 archived messages");
    expect(s.data.messages).toHaveLength(1);
    expect(s.data.summaries).toHaveLength(1);
    await consolidateMemory(s, provider, "", new AbortController().signal);
    expect(chat).toHaveBeenCalledTimes(1);
    s.update((d) => {
      d.messages = [];
    });
    expect(s.data.summaries).toEqual([]);
  });
  it("never saves a model summary after deletion races or cancellation", async () => {
    const s = setup();
    s.update((d) => {
      d.messages.push({
        id: "m",
        characterId: "eva",
        sessionId: "older",
        role: "user",
        content: "cottage",
        createdAt: now,
      });
    });
    const provider = new OpenAICompatibleProvider();
    vi.spyOn(provider, "chat").mockImplementation(async () => {
      s.update((d) => {
        d.messages = [];
      });
      return '{"summary":"stale"}';
    });
    await expect(
      consolidateMemory(s, provider, "", new AbortController().signal),
    ).rejects.toThrow("Source history changed");
    expect(s.data.summaries).toEqual([]);
  });
  it("consolidates attributed conversation chunks and isolates FTS by character", () => {
    const s = setup();
    s.update((d) => {
      d.messages = Array.from({ length: 24 }, (_, i) => ({
        id: `m${i}`,
        characterId: i < 12 ? "eva" : "other",
        sessionId: "archive",
        role: i % 2 ? "assistant" : "user",
        content: `Cottage plan ${i}`,
        createdAt: now,
      }));
    });
    const docs = memoryDocuments(s.data);
    expect(docs.filter((d) => d.kind === "summary")).toHaveLength(2);
    expect(docs.find((d) => d.id === "message:m0")!.text).toContain(
      "Assistant (not verified fact)",
    );
    const hits = s.library.search("eva", 'Cottage OR "*');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits).not.toContain("message:m12");
    expect(
      retrieveMemory(s.data, "cottage").every((d) => d.characterId === "eva"),
    ).toBe(true);
  });
  it("retains lexical matches when embeddings are missing, rejects irrelevant facts and respects zero recall", () => {
    const s = setup();
    s.update((d) => {
      d.facts = ["cottage", "spaceship"].map((text) => ({
        id: text,
        text,
        characterId: "eva",
        source: "manual",
        createdAt: now,
        updatedAt: now,
      }));
    });
    expect(
      retrieveMemory(s.data, "cottage", new Map()).map((d) => d.id),
    ).toEqual(["fact:cottage"]);
    expect(retrieveMemory(s.data, "unrelated")).toEqual([]);
    s.update((d) => {
      d.settings.memory.recallCount = 0;
    });
    expect(retrieveMemory(s.data, "cottage")).toEqual([]);
  });
  it("migrates inline images without losing them and explicitly purges recoverable deleted attachments", () => {
    const s = setup();
    s.update((d) => {
      d.messages.push({
        id: "image",
        characterId: "eva",
        sessionId: "archive",
        role: "user",
        content: "cottage",
        images: [image],
        createdAt: now,
      });
    });
    expect(readFileSync(s.file, "utf8")).not.toContain("data:image");
    expect(readdirSync(s.attachments.directory)).toHaveLength(1);
    const reopened = new Store(path.dirname(s.file));
    stores.push(reopened);
    expect(reopened.data.messages[0].images).toEqual([image]);
    expect(JSON.stringify(buildContext(s.data, "cottage"))).toContain(
      image.dataUrl,
    );
    s.update((d) => {
      d.messages = [];
    });
    expect(s.purgeDeleted()).toBe(1);
    expect(JSON.parse(readFileSync(`${s.file}.bak`, "utf8")).messages).toEqual(
      [],
    );
    expect(s.library.search("eva", "cottage")).toEqual([]);
  });
  it("refuses missing/tampered attachment data and never resolves arbitrary paths", () => {
    const s = setup();
    const raw = {
      messages: [{ images: [{ dataUrl: "eva-attachment:../../secret" }] }],
    };
    expect(s.attachments.unpack(raw)).toEqual(raw);
    expect(() =>
      s.attachments.unpack({
        messages: [
          { images: [{ dataUrl: `eva-attachment:${"a".repeat(64)}` }] },
        ],
      }),
    ).toThrow();
  });
  it("encrypts archives with authentication and random salts; plaintext imports remain compatible", async () => {
    const raw = JSON.stringify({
      version: 1,
      facts: ["private cats"],
      messages: [],
    });
    const a = await encryptArchive(raw, "a long passphrase"),
      b = await encryptArchive(raw, "a long passphrase");
    expect(a).not.toEqual(b);
    expect(a).not.toContain("private cats");
    expect(await decryptArchive(JSON.parse(a), "a long passphrase")).toEqual(
      JSON.parse(raw),
    );
    await expect(
      decryptArchive(JSON.parse(a), "wrong passphrase"),
    ).rejects.toThrow("Nothing was imported");
    await expect(
      decryptArchive(
        { ...JSON.parse(a), tag: "0".repeat(32) },
        "a long passphrase",
      ),
    ).rejects.toThrow();
    expect(await decryptArchive(JSON.parse(raw))).toEqual(JSON.parse(raw));
  });
  it("projects real vectors deterministically and only links similar original vectors", () => {
    const entries = [
      { id: "a", vector: [1, 0, 0] },
      { id: "b", vector: [1, 0.1, 0] },
      { id: "c", vector: [-1, 0, 0] },
    ];
    const p = projectEmbeddings(entries);
    expect(p).toEqual(projectEmbeddings(entries));
    expect(p.nodes).toHaveLength(3);
    expect(p.links).toHaveLength(1);
    expect(p.links[0].similarity).toBeGreaterThan(0.99);
    expect(
      p.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)),
    ).toBe(true);
    expect(
      projectEmbeddings([
        { id: "zero", vector: [0] },
        { id: "zero2", vector: [0] },
      ]).nodes.every((n) => n.x === 50),
    ).toBe(true);
  });
});
describe("voice and character presentation", () => {
  it("uses OpenRouter's transcription catalog without changing generic model discovery", async () => {
    const fetcher = vi.fn(async (_url: string, _options?: RequestInit) =>
      Response.json({ data: [{ id: "qwen/qwen3-asr-0.6b" }] }),
    );
    vi.stubGlobal("fetch", fetcher);
    const provider = new OpenAICompatibleProvider();
    const config = {
      ...defaultSettings.providers.asr,
      baseUrl: "https://openrouter.ai/api/v1",
    };
    expect(await provider.models(config, "", "asr")).toEqual([
      "qwen/qwen3-asr-0.6b",
    ]);
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://openrouter.ai/api/v1/models?output_modalities=transcription",
    );
    await provider.models(config, "", "embedding");
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      "https://openrouter.ai/api/v1/embeddings/models",
    );
    await provider.models(
      { ...config, baseUrl: "http://127.0.0.1:3900/v1" },
      "",
      "asr",
    );
    expect(fetcher.mock.calls[2]?.[0]).toBe("http://127.0.0.1:3900/v1/models");
  });
  it("accepts Qwen-style cumulative partial transcripts without duplicating revisions", async () => {
    const events = [
      { type: "transcription.partial", text: "Hello worl" },
      { type: "transcription.partial", text: "Hi world" },
      { type: "transcription.done", text: "Hi world!" },
    ];
    const partial: string[] = [];
    expect(
      await consumeTranscription(
        new Response(
          events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
        ),
        (text) => partial.push(text),
      ),
    ).toBe("Hi world!");
    expect(partial).toEqual(["Hello worl", "Hi world", "Hi world!"]);
  });
  it("streams partial transcription, requires completion and never retries uploads", async () => {
    const body =
      'data: {"type":"transcript.text.delta","delta":"hello"}\n\ndata: {"type":"transcript.text.done","text":"Hello!"}\n\n';
    const partial: string[] = [];
    expect(
      await consumeTranscription(new Response(body), (t) => partial.push(t)),
    ).toBe("Hello!");
    expect(partial).toEqual(["hello", "Hello!"]);
    await expect(
      consumeTranscription(
        new Response('data: {"type":"transcript.text.delta","delta":"half"}\n'),
        () => {},
      ),
    ).rejects.toThrow("ended early");
    const fetch = vi.fn().mockResolvedValue(
      new Response(body, {
        headers: { "content-type": "text/event-stream" },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    expect(
      await new OpenAICompatibleProvider().transcribe(
        { ...defaultSettings.providers.asr, enabled: true },
        "",
        new ArrayBuffer(44),
        "audio/wav",
        "",
        undefined,
        () => {},
      ),
    ).toBe("Hello!");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((fetch.mock.calls[0][1].body as FormData).get("stream")).toBe(
      "true",
    );
  });
  it("uses bounded vowel shapes and gesture selection", () => {
    expect(visemeAt("aиuео", 0, 5)).toBe("aa");
    expect(visemeAt("aиuео", 1, 5)).toBe("ih");
    expect(visemeAt("aиuео", 2, 5)).toBe("ou");
    expect(visemeAt(" ", 0, 1)).toBeUndefined();
    expect(selectGesture("Really?", 80, 50)).toBe("modelPose");
    expect(selectGesture("Hooray!", 90, 80)).toBe("peaceSign");
    expect(selectGesture("Hi", 60, 10)).toBeUndefined();
  });
  it("strips credentials from cards and validates embedded GLB boundaries", () => {
    const raw = {
      format: "evangelion-character",
      version: 1,
      character: { ...defaultSettings.characters[0], apiKey: "secret" },
      avatar: { kind: "builtin" },
      providers: { key: "secret" },
    };
    const card = characterCardSchema.parse(raw);
    expect(JSON.stringify(card)).not.toContain("secret");
    expect(cardAvatar(card)).toBeUndefined();
    expect(() =>
      cardAvatar({ ...card, avatar: { kind: "embedded", vrm: "eA==" } }),
    ).toThrow("Invalid embedded VRM");
  });
});
