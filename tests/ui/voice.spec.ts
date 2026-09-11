import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

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
  await page
    .getByRole("button", { name: "Voice & audio", exact: true })
    .click();
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
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".success-notice")).toContainText("Settings saved");
  await page.getByRole("button", { name: "Memory", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Semantic memory", exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Providers", exact: true }).click();
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
