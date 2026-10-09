import { bridge } from "../bridge";
import type { Settings } from "../shared/schema";
import { visemeAt, type Viseme } from "./visemes";

/** Removing a source can emit a media error; disconnect callbacks before touching it. */
export function releasePlayer(player: HTMLAudioElement) {
  player.onended = null;
  player.onerror = null;
  player.onplaying = null;
  player.pause();
  player.removeAttribute("src");
  player.load();
}
type SinkContext = AudioContext & { setSinkId?: (id: string) => Promise<void> };
export async function routeOutput(context: SinkContext, deviceId: string) {
  if (!deviceId) return;
  if (!context.setSinkId)
    throw new Error(
      "Output device selection is unavailable in this browser. Use the system default or the desktop app.",
    );
  try {
    await context.setSinkId(deviceId);
  } catch {
    throw new Error(
      "The selected output device is unavailable. Choose another device in Voice & audio.",
    );
  }
}
export async function playSpeech(
  text: string,
  voice: Settings["voice"],
  signal: AbortSignal,
  onLevel: (value: number) => void,
  onPlaying: () => void,
  onViseme?: (value: Viseme | undefined) => void,
) {
  signal.throwIfAborted();
  const player = new Audio();
  player.volume = voice.volume;
  const context = new AudioContext();
  let url = "",
    frame = 0,
    id = "",
    sourceBuffer: SourceBuffer | undefined;
  let finish!: () => void, fail!: (error: unknown) => void;
  const ended = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  // Always install a rejection handler before network activity can fail or be cancelled.
  void ended.catch(() => {});
  const abort = () => {
    releasePlayer(player);
    fail(signal.reason ?? new DOMException("Stopped", "AbortError"));
  };
  signal.addEventListener("abort", abort, { once: true });
  const event = (target: EventTarget, name: string) =>
    new Promise<void>((resolve, reject) => {
      const done = () => {
        cleanup();
        resolve();
      };
      const failed = () => {
        cleanup();
        reject(
          new Error(
            "The provider audio could not be decoded. Check its output format.",
          ),
        );
      };
      const cancelled = () => {
        cleanup();
        reject(signal.reason);
      };
      const cleanup = () => {
        target.removeEventListener(name, done);
        target.removeEventListener("error", failed);
        signal.removeEventListener("abort", cancelled);
      };
      target.addEventListener(name, done, { once: true });
      target.addEventListener("error", failed, { once: true });
      signal.addEventListener("abort", cancelled, { once: true });
      if (signal.aborted) cancelled();
    });
  try {
    await routeOutput(context, voice.outputDeviceId);
    await context.resume();
    signal.throwIfAborted();
    const source = context.createMediaElementSource(player);
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyser.connect(context.destination);
    const values = new Uint8Array(analyser.fftSize);
    const sample = () => {
      const duration =
        Number.isFinite(player.duration) && player.duration > 0
          ? player.duration
          : Math.max(0.3, [...text].length / (13 * voice.speed));
      onViseme?.(visemeAt(text, player.currentTime, duration));
      analyser.getByteTimeDomainData(values);
      onLevel(
        Math.sqrt(
          values.reduce((sum, n) => sum + ((n - 128) / 128) ** 2, 0) /
            values.length,
        ),
      );
      frame = requestAnimationFrame(sample);
    };
    player.onended = finish;
    player.onerror = () =>
      fail(
        new Error(
          "The provider audio could not be decoded. Check its output format.",
        ),
      );
    player.onplaying = () => {
      onPlaying();
      cancelAnimationFrame(frame);
      sample();
    };
    if (voice.streaming) {
      const stream = await bridge.openSpeech(text);
      id = stream.id;
      signal.throwIfAborted();
      const mime = stream.mime === "audio/mp3" ? "audio/mpeg" : stream.mime;
      const canStream =
        typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(mime);
      if (canStream) {
        const media = new MediaSource();
        url = URL.createObjectURL(media);
        const opened = event(media, "sourceopen");
        player.src = url;
        await opened;
        sourceBuffer = media.addSourceBuffer(mime);
        let started = false,
          bytes = 0;
        for (;;) {
          signal.throwIfAborted();
          const part = await bridge.readSpeech(id);
          signal.throwIfAborted();
          if (part.bytes.byteLength) {
            bytes += part.bytes.byteLength;
            const appended = event(sourceBuffer, "updateend");
            sourceBuffer.appendBuffer(part.bytes);
            await appended;
            if (!started) {
              started = true;
              void player.play().catch(fail);
            }
          }
          if (part.done) break;
        }
        if (!bytes)
          throw new Error("The speech provider returned empty audio.");
        if (media.readyState === "open") media.endOfStream();
      } else {
        // WAV and unsupported containers cannot be appended with MSE. Retain correct playback.
        const chunks: ArrayBuffer[] = [];
        for (;;) {
          const part = await bridge.readSpeech(id);
          signal.throwIfAborted();
          if (part.bytes.byteLength) chunks.push(part.bytes);
          if (part.done) break;
        }
        if (!chunks.length)
          throw new Error("The speech provider returned empty audio.");
        url = URL.createObjectURL(new Blob(chunks, { type: mime }));
        player.src = url;
        await player.play();
      }
    } else {
      const bytes = await bridge.speak(text);
      signal.throwIfAborted();
      url = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
      player.src = url;
      await player.play();
    }
    await ended;
  } finally {
    onViseme?.(undefined);
    signal.removeEventListener("abort", abort);
    releasePlayer(player);
    if (id) await bridge.closeSpeech(id).catch(() => {});
    cancelAnimationFrame(frame);
    onLevel(0);
    if (url) URL.revokeObjectURL(url);
    await context.close().catch(() => {});
  }
}
