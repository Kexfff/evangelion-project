import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleProvider } from "../electron/providers";
import { pcmSpeechToWav } from "../electron/pcm-speech";
import { defaultSettings } from "../src/shared/schema";
import { TelegramHTTP } from "../electron/telegram-api";
import { Store } from "../electron/store";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { providerSchema } from "../src/shared/schema";

afterEach(() => vi.unstubAllGlobals());
const gemini = {
  ...defaultSettings.providers.tts,
  enabled: true,
  baseUrl: "https://openrouter.ai/api/v1",
  model: "google/gemini-3.8-flash-lite-tts",
  voice: "Leda",
  responseFormat: "pcm" as const,
};
const pcmResponse = () =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        // HTTP chunks need not align to PCM sample boundaries.
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6, 7, 8]));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "audio/pcm;rate=24000;channels=1" } },
  );

describe("selectable PCM speech", () => {
  it("migrates old Gemini settings once and preserves explicit format choices across restart", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "eva-tts-format-"));
    let store: Store | undefined;
    try {
      store = new Store(dir);
      const raw = JSON.parse(readFileSync(store.file, "utf8"));
      raw.settings.providers.tts = { ...gemini };
      delete raw.settings.providers.tts.responseFormat;
      store.library.sql.close();
      store = undefined;
      writeFileSync(path.join(dir, "companion.json"), JSON.stringify(raw));
      store = new Store(dir);
      expect(store.data.settings.providers.tts.responseFormat).toBe("pcm");
      store.update(() => {});
      store.library.sql.close();
      store = new Store(dir);
      expect(store.data.settings.providers.tts.responseFormat).toBe("pcm");
      store.update((d) => {
        d.settings.providers.tts.responseFormat = "mp3";
      });
      store.library.sql.close();
      store = new Store(dir);
      expect(store.data.settings.providers.tts.responseFormat).toBe("mp3");
      // New profiles and older non-Gemini providers use MP3; invalid values cannot save.
      expect(
        providerSchema.parse({
          ...defaultSettings.providers.tts,
          responseFormat: undefined,
        }).responseFormat,
      ).toBe("mp3");
      expect(
        providerSchema.safeParse({ ...gemini, responseFormat: "invalid" })
          .success,
      ).toBe(false);
    } finally {
      store?.library.sql.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it.each([
    { ...gemini, baseUrl: "http://127.0.0.1:3900/v1", model: "local-voice" },
    { ...gemini, model: "another/pcm-only-model" },
  ])("supports PCM by choice at $baseUrl with $model", async (config) => {
    const fetcher = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(new Uint8Array(8), {
          headers: { "Content-Type": "application/octet-stream" },
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const response = await new OpenAICompatibleProvider().speechResponse(
      config,
      "test-key",
      "Hello.",
      1,
    );
    expect(response.headers.get("content-type")).toBe("audio/wav");
    expect(
      JSON.parse(String(fetcher.mock.calls[0][1]?.body)).response_format,
    ).toBe("pcm");
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("requests PCM once and returns a correctly sized WAV for streaming and buffered callers", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      pcmResponse(),
    );
    vi.stubGlobal("fetch", fetcher);
    const provider = new OpenAICompatibleProvider();
    const response = await provider.speechResponse(
      gemini,
      "test-key",
      "Hello.",
      1,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({
      model: gemini.model,
      voice: "Leda",
      response_format: "pcm",
    });
    expect(response.headers.get("content-type")).toBe("audio/wav");
    const bytes = await response.arrayBuffer(),
      view = new DataView(bytes);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe("WAVE");
    expect(view.getUint32(4, true)).toBe(bytes.byteLength - 8);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(24000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(8);
    expect([...new Uint8Array(bytes.slice(44))]).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    const buffered = await provider.speak(gemini, "test-key", "Hello.", 1);
    expect([...new Uint8Array(buffered)]).toEqual([...new Uint8Array(bytes)]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("honors explicit MP3 for any model including Gemini", async () => {
    const fetcher = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(new Uint8Array([73, 68, 51]), {
          headers: { "Content-Type": "audio/mpeg" },
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    for (const config of [
      gemini,
      { ...gemini, model: "x-ai/grok-voice-tts-1.0", voice: "eve" },
      { ...gemini, baseUrl: "http://127.0.0.1:3900/v1" },
    ])
      await new OpenAICompatibleProvider().speechResponse(
        { ...config, responseFormat: "mp3" },
        "test-key",
        "Hello.",
        1,
      );
    for (const [, init] of fetcher.mock.calls)
      expect(JSON.parse(String(init?.body)).response_format).toBe("mp3");
  });
  it("honors valid PCM rate/channel metadata and rejects incomplete frames or unsupported settings", async () => {
    const response = await pcmSpeechToWav(
      new Response(new Uint8Array(8), {
        headers: { "Content-Type": 'audio/pcm; rate="16000"; channels=2' },
      }),
    );
    const view = new DataView(await response.arrayBuffer());
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(28, true)).toBe(64000);
    await expect(
      pcmSpeechToWav(new Response(new Uint8Array(3))),
    ).rejects.toThrow("incomplete PCM");
    await expect(
      pcmSpeechToWav(new Response(new Uint8Array(0))),
    ).rejects.toThrow("empty audio");
    await expect(
      pcmSpeechToWav(
        new Response(new Uint8Array(2), {
          headers: { "Content-Type": "audio/pcm;rate=garbage" },
        }),
      ),
    ).rejects.toThrow("unsupported PCM");
  });
  it("cancels the PCM reader when stopped", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }));
    const controller = new AbortController();
    controller.abort();
    await expect(pcmSpeechToWav(response, controller.signal)).rejects.toThrow();
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("delivers WAV Telegram replies as files while retaining MP3 voice notes", async () => {
    const request = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        Response.json({ ok: true, result: {} }),
    );
    const api = new TelegramHTTP("test-token", request);
    const wav = new Uint8Array(
      await (await pcmSpeechToWav(pcmResponse())).arrayBuffer(),
    );
    await api.call(
      "sendVoice",
      { chat_id: 1, audio: wav },
      new AbortController().signal,
    );
    expect(request.mock.calls[0][0]).toBe(
      "https://api.telegram.org/bottest-token/sendDocument",
    );
    const upload = (request.mock.calls[0][1]!.body as FormData).get(
      "document",
    ) as File;
    expect(upload.name).toBe("reply.wav");
    expect(upload.type).toBe("audio/wav");
    expect(upload.size).toBe(wav.length);
    await api.call(
      "sendVoice",
      { chat_id: 1, audio: new Uint8Array([73, 68, 51]) },
      new AbortController().signal,
    );
    expect(request.mock.calls[1][0]).toBe(
      "https://api.telegram.org/bottest-token/sendVoice",
    );
    expect(
      ((request.mock.calls[1][1]!.body as FormData).get("voice") as File).type,
    ).toBe("audio/mpeg");
  });
});
