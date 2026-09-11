import { useEffect, useRef, useState } from "react";
import { bridge } from "./bridge";
import type { Phase, Snapshot } from "./shared/schema";
import type { ImageAttachment } from "./shared/images";
import { SentenceBuffer } from "./audio/sentences";
import { playSpeech } from "./audio/playback";
import { MicrophoneCapture } from "./audio/microphone";

export function useCompanion() {
  const [state, setState] = useState<Snapshot>();
  const [phase, setPhase] = useState<Phase>("idle");
  const [partial, setPartial] = useState("");
  const [error, setError] = useState("");
  const [amplitude, setAmplitude] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const [micOn, setMicOn] = useState(false);
  const latest = useRef<Snapshot | undefined>(undefined);
  const generation = useRef(0);
  const active = useRef(true);
  const microphone = useRef<MicrophoneCapture | null>(null);
  const capturing = useRef(false);
  const transcribing = useRef(false);
  const generating = useRef(false);
  const speaking = useRef(false);
  const audio = useRef<AbortController | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const buffer = useRef(new SentenceBuffer());
  const accepting = useRef(false);
  const interrupting = useRef<Promise<void>>(Promise.resolve());
  const report = (err: unknown) => {
    if (active.current)
      setError(
        err instanceof Error
          ? err.message.replace(
              /^Error invoking remote method '[^']+': (?:Error: )?/,
              "",
            )
          : String(err),
      );
  };
  function restingPhase() {
    if (!active.current) return;
    setPhase(
      capturing.current
        ? "listening"
        : transcribing.current
          ? "transcribing"
          : speaking.current
            ? "speaking"
            : generating.current
              ? "thinking"
              : microphone.current
                ? "listening"
                : "idle",
    );
  }
  function closeMicrophone() {
    microphone.current?.close();
    microphone.current = null;
    capturing.current = false;
    setMicOn(false);
    setMicLevel(0);
  }
  function interrupt(closeMic = false) {
    ++generation.current;
    accepting.current = false;
    audio.current?.abort();
    audio.current = null;
    speaking.current = false;
    generating.current = false;
    transcribing.current = false;
    queue.current = Promise.resolve();
    buffer.current = new SentenceBuffer();
    if (closeMic) closeMicrophone();
    setPartial("");
    setAmplitude(0);
    restingPhase();
    interrupting.current = bridge.cancel().catch(report);
    return interrupting.current;
  }
  function enqueue(text: string, token: number) {
    if (!text.trim() || token !== generation.current) return;
    const voice = latest.current!.settings.voice;
    queue.current = queue.current.then(async () => {
      if (token !== generation.current || !active.current) return;
      const controller = new AbortController();
      audio.current = controller;
      speaking.current = true;
      restingPhase();
      try {
        await playSpeech(
          text,
          voice,
          controller.signal,
          (value) => {
            if (token === generation.current && active.current)
              setAmplitude(value);
          },
          () => {
            if (token === generation.current) restingPhase();
          },
        );
      } catch (err) {
        if (token === generation.current && !controller.signal.aborted)
          report(err);
      } finally {
        if (token === generation.current) {
          audio.current = null;
          speaking.current = false;
          restingPhase();
        }
      }
    });
  }
  useEffect(() => {
    active.current = true;
    void bridge
      .snapshot()
      .then((s) => {
        if (active.current) {
          latest.current = s;
          setState(s);
        }
      })
      .catch(report);
    const off = bridge.onEvent((event) => {
      if (event.type === "state") {
        const old = latest.current;
        const changedSession =
          old &&
          (old.sessionId !== event.state.sessionId ||
            old.settings.activeCharacterId !==
              event.state.settings.activeCharacterId);
        const changedVoice =
          old &&
          JSON.stringify(old.settings.voice) !==
            JSON.stringify(event.state.settings.voice);
        latest.current = event.state;
        setState(event.state);
        if (changedSession || changedVoice) void interrupt(true);
        if (!event.state.busy) setPartial("");
      } else if (event.type === "delta" && accepting.current) {
        setPartial((p) => p + event.text);
        const s = latest.current?.settings;
        if (
          s?.voice.autoSpeak &&
          s.voice.sentenceBuffering &&
          s.providers.tts.enabled
        )
          for (const sentence of buffer.current.push(event.text))
            enqueue(sentence, generation.current);
      } else if (event.type === "warning") report(event.message);
    });
    return () => {
      active.current = false;
      off();
      generation.current++;
      accepting.current = false;
      audio.current?.abort();
      microphone.current?.close();
      void bridge.cancel();
    };
  }, []);
  async function send(text: string, images: ImageAttachment[] = []) {
    if ((!text.trim() && !images.length) || !latest.current) return;
    const interrupted = interrupt();
    const token = generation.current;
    await interrupted;
    if (token !== generation.current || !active.current) return;
    setError("");
    buffer.current = new SentenceBuffer();
    generating.current = true;
    accepting.current = true;
    restingPhase();
    try {
      await bridge.send(text.trim(), images);
      if (token !== generation.current) return;
      accepting.current = false;
      generating.current = false;
      const next = await bridge.snapshot();
      if (token !== generation.current) return;
      latest.current = next;
      setState(next);
      const s = next.settings;
      if (s.voice.autoSpeak && s.providers.tts.enabled) {
        if (s.voice.sentenceBuffering)
          for (const sentence of buffer.current.push("", true))
            enqueue(sentence, token);
        else if (next.messages.at(-1)?.role === "assistant")
          enqueue(next.messages.at(-1)!.content, token);
      }
      restingPhase();
    } catch (err) {
      if (token === generation.current) {
        report(err);
        await interrupt();
      }
    } finally {
      if (token === generation.current) {
        accepting.current = false;
        generating.current = false;
        restingPhase();
      }
    }
  }
  async function speak(text: string) {
    const interrupted = interrupt();
    const token = generation.current;
    await interrupted;
    if (token !== generation.current) return;
    setError("");
    enqueue(text, token);
    await queue.current;
  }
  async function toggleRecording() {
    if (microphone.current) {
      if (latest.current?.settings.voice.vadEnabled) {
        await interrupt(true);
        return;
      }
      const mic = microphone.current;
      mic.finish();
      mic.close();
      microphone.current = null;
      capturing.current = false;
      setMicOn(false);
      restingPhase();
      return;
    }
    const settings = latest.current?.settings;
    if (!settings?.providers.asr.enabled) {
      report(
        new Error("Enable speech recognition in Settings → Providers first."),
      );
      return;
    }
    await interrupt();
    setError("");
    const mic = new MicrophoneCapture(settings.voice, {
      level: (n) => {
        if (active.current) setMicLevel(n);
      },
      acceptsSpeech: () =>
        !transcribing.current &&
        ((!generating.current && !speaking.current) || settings.voice.bargeIn),
      start: () => {
        capturing.current = true;
        void interrupt();
        restingPhase();
      },
      utterance: (wav) => {
        capturing.current = false;
        transcribing.current = true;
        restingPhase();
        if (!settings.voice.vadEnabled) {
          microphone.current = null;
          setMicOn(false);
        }
        const token = generation.current;
        void (async () => {
          try {
            await interrupting.current;
            if (token !== generation.current) return;
            const text = await bridge.transcribe(wav, "audio/wav");
            if (token !== generation.current) return;
            transcribing.current = false;
            await send(text);
          } catch (err) {
            if (token === generation.current) {
              report(err);
              transcribing.current = false;
              restingPhase();
            }
          }
        })();
      },
      error: (err) => {
        report(err);
        closeMicrophone();
        restingPhase();
      },
    });
    microphone.current = mic;
    setMicOn(true);
    try {
      await mic.open();
      if (microphone.current === mic) restingPhase();
    } catch (err) {
      if (microphone.current === mic) {
        microphone.current = null;
        setMicOn(false);
        report(err);
        restingPhase();
      }
    }
  }
  return {
    state,
    phase,
    partial,
    error,
    setError,
    amplitude,
    micLevel,
    micOn,
    send,
    stop: () => interrupt(true),
    speak,
    toggleRecording,
    report,
  };
}
