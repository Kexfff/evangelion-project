import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

test("plays Gemini PCM as WAV with speech streaming both enabled and disabled", async ({
  page,
}) => {
  await page.goto("/?window=companion");
  await page.getByRole("textbox", { name: "Message Eva" }).click();
  const result = await page.evaluate(async () => {
    const bridgePath = "/src/bridge.ts",
      playbackPath = "/src/audio/playback.ts",
      schemaPath = "/src/shared/schema.ts",
      pcmPath = "/electron/pcm-speech.ts";
    const { bridge } = await import(bridgePath);
    const { playSpeech } = await import(playbackPath);
    const { defaultSettings } = await import(schemaPath);
    const { pcmSpeechToWav } = await import(pcmPath);
    const pcm = new Uint8Array((24000 * 2) / 5),
      samples = new DataView(pcm.buffer);
    for (let i = 0; i < pcm.length / 2; i++)
      samples.setInt16(
        i * 2,
        Math.round(Math.sin((i / 24000) * 2 * Math.PI * 220) * 1000),
        true,
      );
    const response = await pcmSpeechToWav(
      new Response(pcm.buffer, {
        headers: { "Content-Type": "audio/pcm;rate=24000;channels=1" },
      }),
    );
    const bytes = await response.arrayBuffer();
    let playing = 0,
      closed = 0;
    const types: string[] = [],
      create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob: Blob | MediaSource) => {
      if (blob instanceof Blob) types.push(blob.type);
      return create(blob);
    };
    bridge.speak = async () => bytes;
    bridge.openSpeech = async () => ({
      id: "pcm-fixture",
      mime: response.headers.get("content-type")!,
    });
    bridge.closeSpeech = async () => {
      closed++;
    };
    let read = false;
    bridge.readSpeech = async () => {
      if (read) return { done: true, bytes: new ArrayBuffer(0) };
      read = true;
      return { done: false, bytes };
    };
    try {
      for (const streaming of [false, true]) {
        await playSpeech(
          "Hello.",
          { ...defaultSettings.voice, streaming },
          new AbortController().signal,
          () => {},
          () => {
            playing++;
          },
        );
      }
    } finally {
      URL.createObjectURL = create;
    }
    return { playing, closed, types };
  });
  expect(result.playing).toBe(2);
  expect(result.closed).toBe(1);
  expect(result.types).toEqual(["audio/wav", "audio/wav"]);
});

test("streams real MP3 before EOF and cleans up completed and interrupted players", async ({
  page,
}) => {
  const fixture = [...readFileSync(path.resolve("tests/fixtures/speech.mp3"))];
  await page.goto("/?window=companion");
  await page.getByRole("textbox", { name: "Message Eva" }).click();
  const result = await page.evaluate(async (fixture) => {
    const bridgePath = "/src/bridge.ts",
      playbackPath = "/src/audio/playback.ts",
      schemaPath = "/src/shared/schema.ts";
    const { bridge } = await import(bridgePath);
    const { playSpeech } = await import(playbackPath);
    const { defaultSettings } = await import(schemaPath);
    const audio = new Uint8Array(fixture);
    let eof = false,
      reads = 0,
      closed = 0,
      startedBeforeEOF = false;
    let started!: () => void;
    const playing = new Promise<void>((resolve) => {
      started = resolve;
    });
    bridge.openSpeech = async () => ({ id: "fixture", mime: "audio/mpeg" });
    bridge.closeSpeech = async () => {
      closed++;
    };
    bridge.readSpeech = async () => {
      reads++;
      if (reads === 1)
        return { done: false, bytes: audio.slice(0, 3000).buffer };
      if (reads === 2) {
        await Promise.race([
          playing,
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("Playback did not begin before EOF")),
              5000,
            ),
          ),
        ]);
        return { done: false, bytes: audio.slice(3000).buffer };
      }
      eof = true;
      return { done: true, bytes: new ArrayBuffer(0) };
    };
    await playSpeech(
      "Hello.",
      defaultSettings.voice,
      new AbortController().signal,
      () => {},
      () => {
        startedBeforeEOF = !eof;
        started();
      },
    );
    bridge.speak = async () => audio.buffer;
    await playSpeech(
      "Buffered.",
      { ...defaultSettings.voice, streaming: false },
      new AbortController().signal,
      () => {},
      () => {},
    );
    const controller = new AbortController();
    let cancelled = false;
    try {
      await playSpeech(
        "Interrupt.",
        { ...defaultSettings.voice, streaming: false },
        controller.signal,
        () => {},
        () => controller.abort(),
      );
    } catch {
      cancelled = controller.signal.aborted;
    }
    // A cleanup-induced media error is asynchronous; keep the page alive through that turn.
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { startedBeforeEOF, closed, cancelled };
  }, fixture);
  expect(result).toEqual({
    startedBeforeEOF: true,
    closed: 1,
    cancelled: true,
  });
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("exposes sensitivity, VAD, device and semantic-memory controls", async ({
  page,
}) => {
  await page.goto("/?window=settings");
  await page.getByRole("button", { name: "Her voice", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Microphone", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Speakers / headphones" }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", { name: "Hands-free voice detection", exact: false })
    .check();
  await page.getByRole("slider", { name: "Microphone gain" }).fill("1.8");
  const delivery = page.getByRole("combobox", { name: "Speech delivery" });
  await expect(delivery).toHaveValue("sentence");
  await delivery.selectOption("line");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".success-notice")).toContainText("Settings saved");
  await page.getByRole("button", { name: "Memories", exact: true }).click();
  await page.getByRole("button", { name: "Her voice", exact: true }).click();
  await expect(delivery).toHaveValue("line");
  await delivery.selectOption("response");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.evaluate(async () => {
    const bridgePath = "/src/bridge.ts";
    const { bridge } = await import(bridgePath);
    if ((await bridge.snapshot()).settings.voice.sentenceBuffering)
      throw new Error("Full response must disable incremental speech");
  });
  await page.getByRole("button", { name: "Memories", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Semantic memory", exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "AI services", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Fetch models", exact: true }),
  ).toHaveCount(4);
  await expect(
    page.getByRole("heading", { name: "Remember · Embeddings" }),
  ).toBeVisible();
});

test("captures synthetic speech through the audio worklet with VAD and pre-roll", async ({
  page,
}) => {
  await page.goto("/?window=companion");
  await page.getByRole("textbox", { name: "Message Eva" }).click();
  const result = await page.evaluate(async () => {
    const micPath = "/src/audio/microphone.ts",
      schemaPath = "/src/shared/schema.ts";
    const { MicrophoneCapture } = await import(micPath);
    const { defaultSettings } = await import(schemaPath);
    const context = new AudioContext();
    await context.resume();
    const oscillator = context.createOscillator(),
      volume = context.createGain(),
      destination = context.createMediaStreamDestination();
    volume.gain.value = 0;
    oscillator.connect(volume);
    volume.connect(destination);
    oscillator.start();
    const original = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async () => destination.stream;
    let starts = 0,
      maxLevel = 0,
      finish!: (wav: ArrayBuffer) => void;
    const complete = new Promise<ArrayBuffer>((resolve) => {
      finish = resolve;
    });
    const mic = new MicrophoneCapture(
      {
        ...defaultSettings.voice,
        vadEnabled: true,
        vadSilenceMs: 300,
        inputGain: 2,
      },
      {
        level: (v: number) => {
          maxLevel = Math.max(maxLevel, v);
        },
        start: () => {
          starts++;
        },
        utterance: finish,
        error: (e: Error) => {
          throw e;
        },
        acceptsSpeech: () => true,
      },
    );
    try {
      await mic.open();
      const at = context.currentTime;
      volume.gain.setValueAtTime(0.07, at + 0.2);
      volume.gain.setValueAtTime(0, at + 0.85);
      const wav = await Promise.race([
        complete,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("No VAD utterance detected")),
            5000,
          ),
        ),
      ]);
      const view = new DataView(wav);
      return {
        starts,
        audible: maxLevel > 0.08,
        rate: view.getUint32(24, true),
        duration: (wav.byteLength - 44) / 32000,
      };
    } finally {
      mic.close();
      oscillator.stop();
      await context.close();
      navigator.mediaDevices.getUserMedia = original;
    }
  });
  expect(result.starts).toBe(1);
  expect(result.audible).toBe(true);
  expect(result.rate).toBe(16000);
  expect(result.duration).toBeGreaterThan(0.7);
});
