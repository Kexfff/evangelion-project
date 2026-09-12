import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { CredentialVault } from "../electron/credentials";
import { Store } from "../electron/store";
import { defaultSettings } from "../src/shared/schema";
import { OpenAICompatibleProvider } from "../electron/providers";
import { SemanticMemory, cosine } from "../electron/semantic-memory";
import { buildContext } from "../electron/memory";
import { VoiceActivityDetector, encodeWav } from "../src/audio/vad";
import {
  SentenceBuffer,
  LineBuffer,
  createSpeechBuffer,
} from "../src/audio/sentences";
import { CompanionRuntime } from "../electron/runtime";

const dirs: string[] = [];
const temporary = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "eva-15-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  dirs
    .splice(0)
    .forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});
describe("credential persistence and migration", () => {
  it("persists credentials without a keyring, preserves untouched keys and deletes explicitly cleared keys", () => {
    const dir = temporary();
    const vault = new CredentialVault(dir, null);
    vault.save({ llm: "a-secret-api-key", tts: "speech-key" });
    expect(new CredentialVault(dir, null).get("llm")).toBe("a-secret-api-key");
    expect(
      readFileSync(path.join(dir, "credentials.json"), "utf8"),
    ).not.toContain("a-secret-api-key");
    if (process.platform !== "win32")
      expect(statSync(path.join(dir, "credentials.key")).mode & 0o777).toBe(
        0o600,
      );
    const reopened = new CredentialVault(dir, null);
    reopened.save({ tts: "" });
    expect(new CredentialVault(dir, null).get("llm")).toBe("a-secret-api-key");
    expect(new CredentialVault(dir, null).has("tts")).toBe(false);
  });
  it("migrates legacy encrypted maps without overwriting a locked key", () => {
    const dir = temporary();
    const encrypted = Buffer.from("legacy-cipher").toString("base64");
    writeFileSync(
      path.join(dir, "credentials.json"),
      JSON.stringify({ llm: encrypted }),
    );
    const locked = new CredentialVault(dir, null);
    expect(() => locked.get("llm")).toThrow("locked");
    locked.save({ tts: "new-key" });
    const osStorage = {
      encryptString: (s: string) => Buffer.from(s),
      decryptString: () => "recovered-key",
    };
    expect(new CredentialVault(dir, osStorage).get("llm")).toBe(
      "recovered-key",
    );
    expect(new CredentialVault(dir, osStorage).mode).toBe("local-file");
    expect(new CredentialVault(dir, null).get("tts")).toBe("new-key");
  });
  it("loads sprint-1 databases with new defaults while preserving existing values", () => {
    const dir = temporary();
    const store = new Store(dir);
    const old = JSON.parse(readFileSync(store.file, "utf8"));
    old.settings.voice = {
      autoSpeak: false,
      speed: 1.5,
      volume: 0.4,
      language: "ru",
    };
    old.settings.memory = {
      contextMessages: 10,
      recallCount: 3,
      autoRemember: true,
    };
    delete old.settings.providers.embedding;
    writeFileSync(store.file, JSON.stringify(old));
    const upgraded = new Store(dir).data.settings;
    expect(upgraded.voice).toMatchObject({
      speed: 1.5,
      language: "ru",
      inputGain: 1,
      streaming: true,
      speechChunking: "sentence",
    });
    expect(upgraded.providers.embedding.enabled).toBe(false);
    expect(upgraded.memory.semanticEnabled).toBe(false);
  });
});
describe("speech segmentation and input", () => {
  it("keeps short sentences together until a newline and flushes the final line once", () => {
    const buffer = createSpeechBuffer("line");
    expect(buffer.push("Yes. Sure! ")).toEqual([]);
    expect(buffer.push("Really?\nNext")).toEqual(["Yes. Sure! Really?"]);
    expect(buffer.push(" line. Still together.")).toEqual([]);
    expect(buffer.push("", true)).toEqual(["Next line. Still together."]);
    expect(buffer.push("", true)).toEqual([]);
    expect(createSpeechBuffer()).toBeInstanceOf(SentenceBuffer);
  });
  it("handles split CRLF, blank lines, Unicode and arbitrary token boundaries", () => {
    const buffer = new LineBuffer();
    expect(buffer.push("\n  \r\nПривет. Да!\r")).toEqual(["Привет. Да!"]);
    expect(buffer.push("\n\n你好。 好的！\nTail\r\n")).toEqual([
      "你好。 好的！",
      "Tail",
    ]);
    expect(buffer.push("  ", true)).toEqual([]);
    expect(buffer.push("New turn", true)).toEqual(["New turn"]);
  });
  it("does not apply sentence-mode's short fallback but respects the speech API limit", () => {
    const buffer = new LineBuffer();
    const line = "Short. ".repeat(100);
    expect(buffer.push(line)).toEqual([]);
    expect(buffer.push("\n")).toEqual([line.trim()]);
    expect(buffer.push("x".repeat(12001))).toEqual(["x".repeat(12000)]);
    expect(buffer.push("", true)).toEqual(["x"]);
    const large = "word ".repeat(6000);
    const chunks = new LineBuffer().push(large + "\n");
    expect(chunks.every((chunk) => chunk.length <= 12000)).toBe(true);
    expect(chunks.join(" ")).toBe(large.trim());
  });
  it("persists line mode and preserves disabled buffering in older settings", () => {
    const dir = temporary();
    const store = new Store(dir);
    store.update((d) => {
      d.settings.voice.speechChunking = "line";
    });
    expect(new Store(dir).data.settings.voice.speechChunking).toBe("line");
    const old = JSON.parse(readFileSync(store.file, "utf8"));
    delete old.settings.voice.speechChunking;
    old.settings.voice.sentenceBuffering = false;
    writeFileSync(store.file, JSON.stringify(old));
    expect(new Store(dir).data.settings.voice).toMatchObject({
      sentenceBuffering: false,
      speechChunking: "sentence",
    });
  });
  it("buffers arbitrary tokens, abbreviations, decimals and trailing text without duplication", () => {
    const buffer = new SentenceBuffer();
    expect(buffer.push("Dr. Smith likes 3.14")).toEqual([]);
    expect(buffer.push(" pies. Hello! ")).toEqual([
      "Dr. Smith likes 3.14 pies.",
      "Hello!",
    ]);
    expect(buffer.push("Привет. Как дела")).toEqual(["Привет."]);
    expect(buffer.push("", true)).toEqual(["Как дела"]);
    expect(buffer.push("", true)).toEqual([]);
  });
  it("requires sustained speech and uses silence hysteresis before ending an utterance", () => {
    const vad = new VoiceActivityDetector(0.04, 200, 500);
    expect(vad.push(0.08, 100)).toBeUndefined();
    expect(vad.push(0.01, 100)).toBeUndefined();
    expect(vad.push(0.08, 200)).toBe("start");
    expect(vad.push(0.03, 500)).toBeUndefined();
    expect(vad.push(0.001, 400)).toBeUndefined();
    expect(vad.push(0.001, 100)).toBe("end");
    expect(vad.push(0, 2000)).toBeUndefined();
  });
  it("encodes and downsamples microphone audio to valid 16kHz mono PCM WAV", () => {
    const wav = encodeWav([new Float32Array(48000).fill(0.5)], 48000);
    const view = new DataView(wav);
    expect(wav.byteLength).toBe(32044);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getInt16(44, true)).toBeCloseTo(16383, -1);
  });
});
describe("provider discovery and semantic memory", () => {
  it("discovers deduplicated model IDs and preserves provider errors", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{"data":[{"id":"b"},{"id":"a"},{"id":"a"}]}'),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    const provider = new OpenAICompatibleProvider();
    expect(await provider.models(defaultSettings.providers.asr, "")).toEqual([
      "a",
      "b",
    ]);
    expect(fetch.mock.calls[0][0]).toBe("http://127.0.0.1:8000/v1/models");
    await expect(
      provider.models(defaultSettings.providers.tts, ""),
    ).rejects.toThrow("HTTP 404");
  });
  it("orders embedding batches by index and rejects malformed vectors", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          '{"data":[{"index":1,"embedding":[0,1]},{"index":0,"embedding":[1,0]}]}',
        ),
      )
      .mockResolvedValueOnce(
        new Response('{"data":[{"index":0,"embedding":["invalid"]}]}'),
      );
    vi.stubGlobal("fetch", fetch);
    const p = { ...defaultSettings.providers.embedding, enabled: true };
    const adapter = new OpenAICompatibleProvider();
    expect(await adapter.embed(p, "", ["a", "b"])).toEqual([
      [1, 0],
      [0, 1],
    ]);
    await expect(adapter.embed(p, "", ["x"])).rejects.toThrow(
      "invalid vectors",
    );
  });
  it("recalls semantically related facts without shared keywords, persists vectors and removes stale entries", async () => {
    const store = new Store(temporary());
    const provider = new OpenAICompatibleProvider();
    const date = new Date().toISOString();
    store.update((d) => {
      d.settings.providers.embedding.enabled = true;
      d.facts = [
        {
          id: "cat",
          characterId: "eva",
          text: "I adore cats.",
          source: "manual",
          createdAt: date,
          updatedAt: date,
        },
        {
          id: "secret",
          characterId: "other",
          text: "Hidden kittens.",
          source: "manual",
          createdAt: date,
          updatedAt: date,
        },
      ];
    });
    const embed = vi
      .spyOn(provider, "embed")
      .mockImplementation(async (_p, _k, input) => input.map(() => [1, 0, 0]));
    const semantic = new SemanticMemory(store, provider, () => "");
    const scores = await semantic.recall("feline companions");
    expect(scores.get("fact:cat")).toBe(1);
    expect(scores.has("fact:secret")).toBe(false);
    expect(
      buildContext(store.data, "feline companions", scores)[0].content,
    ).toContain("I adore cats.");
    const again = new SemanticMemory(store, provider, () => "");
    await again.recall("furry friend");
    expect(embed).toHaveBeenCalledTimes(3); // first batch + two queries, no repeated document upload
    store.update((d) => {
      d.facts = [];
    });
    again.prune();
    expect(
      JSON.parse(
        readFileSync(
          path.join(path.dirname(store.file), "memory-vectors.json"),
          "utf8",
        ),
      ).entries,
    ).toEqual([]);
    expect(cosine([1, 0], [0, 1])).toBe(0);
  });
  it("invalidates the semantic cache after changing embedding models or editing a fact", async () => {
    const store = new Store(temporary());
    const provider = new OpenAICompatibleProvider();
    const date = new Date().toISOString();
    store.update((d) => {
      d.settings.providers.embedding.enabled = true;
      d.facts.push({
        id: "f",
        characterId: "eva",
        text: "Tea",
        source: "manual",
        createdAt: date,
        updatedAt: date,
      });
    });
    const embed = vi
      .spyOn(provider, "embed")
      .mockImplementation(async (_p, _k, input) => input.map(() => [1, 0]));
    const memory = new SemanticMemory(store, provider, () => "");
    await memory.reindex();
    store.update((d) => {
      d.facts[0].text = "Coffee";
    });
    await memory.reindex();
    store.update((d) => {
      d.settings.providers.embedding.model = "different";
    });
    await memory.reindex();
    expect(embed).toHaveBeenCalledTimes(3);
  });
});
describe("stream lifecycle", () => {
  it("delivers audio chunks before EOF and cancels pending reads", async () => {
    const store = new Store(temporary());
    const runtime = new CompanionRuntime(
      store,
      () => "",
      "local-file",
      () => {},
    );
    let source!: ReadableStreamDefaultController<Uint8Array>;
    vi.spyOn(runtime.provider, "speechResponse").mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            source = c;
          },
        }),
        { headers: { "content-type": "audio/mpeg" } },
      ),
    );
    const stream = await runtime.openSpeech("Hello");
    source.enqueue(new Uint8Array([1, 2]));
    expect(await runtime.readSpeech(stream.id)).toEqual({
      done: false,
      bytes: new Uint8Array([1, 2]).buffer,
    });
    const pending = runtime.readSpeech(stream.id);
    await runtime.cancel();
    expect((await pending).done).toBe(true);
    await expect(runtime.readSpeech(stream.id)).rejects.toThrow("closed");
  });
});
