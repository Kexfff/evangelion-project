import { useEffect, useRef, useState } from "react";
import { bridge } from "./bridge";
import type { Phase, Snapshot } from "./shared/schema";
import type { ImageAttachment } from "./shared/images";
import { createSpeechBuffer } from "./audio/sentences";
import { playSpeech } from "./audio/playback";
import { MicrophoneCapture } from "./audio/microphone";
import { PttEdges, pttKey, pttMatches, type PttAction } from "./shared/ptt";

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
  const keyboardCapture = useRef(false);
  const localKeys = useRef<PttEdges | null>(null);
  const shortcutTest = useRef(false);
  const transcribing = useRef(false);
  const generating = useRef(false);
  const speaking = useRef(false);
  const audio = useRef<AbortController | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const buffer = useRef(createSpeechBuffer());
  const accepting = useRef(false);
  const autonomous = useRef<string | null>(null);
  const draftBusy = useRef(false);
  const pendingSpeech = useRef(0);
  const heartbeat = () => {
    if (active.current)
      void bridge
        .presence({
          visible: document.visibilityState === "visible",
          blocked:
            draftBusy.current ||
            !!microphone.current ||
            generating.current ||
            transcribing.current ||
            speaking.current ||
            pendingSpeech.current > 0,
        })
        .catch(() => {});
  };
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
    heartbeat();
    void bridge
      .voiceActivity(
        keyboardCapture.current
          ? transcribing.current
            ? "transcribing"
            : microphone.current
              ? "listening"
              : "idle"
          : "idle",
      )
      .catch(() => {});
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
    keyboardCapture.current = false;
    localKeys.current?.settled();
    void bridge.pttSettled().catch(() => {});
  }
  function interrupt(closeMic = false) {
    ++generation.current;
    accepting.current = false;
    autonomous.current = null;
    pendingSpeech.current = 0;
    audio.current?.abort();
    audio.current = null;
    speaking.current = false;
    generating.current = false;
    transcribing.current = false;
    queue.current = Promise.resolve();
    buffer.current = createSpeechBuffer(
      latest.current?.settings.voice.speechChunking,
    );
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
    pendingSpeech.current++;
    heartbeat();
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
          pendingSpeech.current--;
          if (!pendingSpeech.current && !generating.current)
            autonomous.current = null;
          audio.current = null;
          speaking.current = false;
          restingPhase();
        }
      }
    });
  }
  useEffect(() => {
    active.current = true;
    const timer = setInterval(heartbeat, 2000);
    document.addEventListener("visibilitychange", heartbeat);
    void bridge
      .pttStatus()
      .then((status) => {
        shortcutTest.current = status.testing;
      })
      .catch(() => {});
    void bridge
      .snapshot()
      .then((s) => {
        if (active.current) {
          latest.current = s;
          setState(s);
          localKeys.current = new PttEdges(
            s.settings.voice.ptt.mode,
            pttAction,
          );
        }
      })
      .catch(report);
    const off = bridge.onEvent((event) => {
      if (event.type === "ptt-action") {
        pttAction(event.action);
      } else if (event.type === "ptt-status") {
        shortcutTest.current = event.status.testing;
      } else if (event.type === "autonomous-start") {
        if (
          draftBusy.current ||
          microphone.current ||
          generating.current ||
          speaking.current ||
          pendingSpeech.current
        ) {
          void bridge.cancel();
          return;
        }
        autonomous.current = event.id;
        ++generation.current;
        buffer.current = createSpeechBuffer(
          latest.current?.settings.voice.speechChunking,
        );
        accepting.current = true;
        generating.current = true;
        setPartial("");
        restingPhase();
      } else if (
        event.type === "autonomous-end" &&
        autonomous.current === event.id
      ) {
        accepting.current = false;
        generating.current = false;
        const s = latest.current?.settings;
        if (s?.voice.autoSpeak && s.providers.tts.enabled) {
          if (s.voice.sentenceBuffering)
            for (const chunk of buffer.current.push("", true))
              enqueue(chunk, generation.current);
          else enqueue(event.text, generation.current);
        }
        if (!pendingSpeech.current) autonomous.current = null;
        restingPhase();
      } else if (event.type === "autonomous-cancel" && autonomous.current) {
        // Local cleanup only: calling cancel again here would recurse through IPC.
        autonomous.current = null;
        ++generation.current;
        accepting.current = false;
        audio.current?.abort();
        audio.current = null;
        pendingSpeech.current = 0;
        queue.current = Promise.resolve();
        speaking.current = false;
        generating.current = false;
        setPartial("");
        setAmplitude(0);
        restingPhase();
      } else if (event.type === "state") {
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
        const stoppedAutonomy =
          autonomous.current &&
          (!event.state.settings.autonomy.enabled ||
            event.state.settings.autonomy.paused);
        latest.current = event.state;
        setState(event.state);
        if (changedSession || changedVoice || stoppedAutonomy) {
          void interrupt(true);
          localKeys.current = new PttEdges(
            event.state.settings.voice.ptt.mode,
            pttAction,
          );
        }
        if (!event.state.busy) setPartial("");
      } else if (event.type === "delta" && accepting.current) {
        if (event.autonomousId && event.autonomousId !== autonomous.current)
          return;
        setPartial((p) => p + event.text);
        const s = latest.current?.settings;
        if (
          s?.voice.autoSpeak &&
          s.voice.sentenceBuffering &&
          s.providers.tts.enabled
        )
          for (const chunk of buffer.current.push(event.text))
            enqueue(chunk, generation.current);
      } else if (event.type === "warning") report(event.message);
    });
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && (microphone.current || transcribing.current)) {
        void interrupt(true);
        return;
      }
      const c = latest.current?.settings.voice.ptt;
      if (
        !c?.enabled ||
        c.scope !== "app" ||
        shortcutTest.current ||
        e.repeat ||
        e.isComposing ||
        (e.target instanceof Element &&
          e.target.closest("input,textarea,select,[contenteditable=true]"))
      )
        return;
      if (pttMatches(e, c)) {
        e.preventDefault();
        localKeys.current?.press();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const c = latest.current?.settings.voice.ptt;
      if (c?.enabled && c.scope === "app" && pttKey(e) === c.key)
        localKeys.current?.release();
    };
    const onBlur = () => {
      const c = latest.current?.settings.voice.ptt;
      if (c?.enabled && c.scope === "app") {
        if (keyboardCapture.current) localKeys.current?.cancel();
        else localKeys.current = new PttEdges(c.mode, pttAction);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    const hidden = () => {
      if (document.hidden) onBlur();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      active.current = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", heartbeat);
      void bridge.presence({ blocked: true, visible: false }).catch(() => {});
      off();
      generation.current++;
      accepting.current = false;
      audio.current?.abort();
      microphone.current?.close();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", hidden);
      void bridge.voiceActivity("idle").catch(() => {});
      void bridge.cancel();
    };
  }, []);
  async function send(text: string, images: ImageAttachment[] = []) {
    if ((!text.trim() && !images.length) || !latest.current) return;
    if (
      microphone.current &&
      (keyboardCapture.current || !latest.current.settings.voice.vadEnabled)
    )
      closeMicrophone();
    keyboardCapture.current = false;
    const interrupted = interrupt();
    const token = generation.current;
    await interrupted;
    if (token !== generation.current || !active.current) return;
    setError("");
    buffer.current = createSpeechBuffer(
      latest.current.settings.voice.speechChunking,
    );
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
          for (const chunk of buffer.current.push("", true))
            enqueue(chunk, token);
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
  function pttAction(action: PttAction) {
    if (action === "cancel") {
      void interrupt(true);
      return;
    }
    if (!latest.current?.settings.voice.ptt.enabled || shortcutTest.current)
      return;
    if (action === "start") void startRecording(true);
    else if (keyboardCapture.current) void finishRecording();
  }
  async function finishRecording() {
    const mic = microphone.current;
    if (!mic) return;
    await mic.finishAndSend();
    if (microphone.current === mic) closeMicrophone();
    restingPhase();
  }
  async function toggleRecording() {
    if (microphone.current) {
      if (
        latest.current?.settings.voice.vadEnabled &&
        !latest.current.settings.voice.ptt.enabled
      )
        await interrupt(true);
      else await finishRecording();
    } else
      await startRecording(latest.current?.settings.voice.ptt.enabled ?? false);
  }
  async function startRecording(ptt = false) {
    if (microphone.current) return;
    const settings = latest.current?.settings;
    const reject = (message: string) => {
      report(new Error(message));
      localKeys.current?.settled();
      void bridge.pttSettled().catch(() => {});
    };
    if (!settings?.providers.asr.enabled) {
      reject("Enable speech recognition in Settings → Providers first.");
      return;
    }
    if (transcribing.current || (ptt && draftBusy.current)) {
      reject(
        "Finish the current message or transcription before recording another.",
      );
      return;
    }
    if (
      ptt &&
      (generating.current || speaking.current || latest.current?.busy) &&
      !settings.voice.bargeIn
    ) {
      reject(
        "Eva is replying. Wait, or enable ‘Interrupt when I speak’ in Voice & audio.",
      );
      return;
    }
    const interrupted = interrupt();
    const token = generation.current;
    setError("");
    const voice = {
      ...settings.voice,
      vadEnabled: !ptt && settings.voice.vadEnabled,
    };
    keyboardCapture.current = ptt;
    const mic = new MicrophoneCapture(
      voice,
      {
        level: (n) => {
          if (active.current && microphone.current === mic) setMicLevel(n);
        },
        acceptsSpeech: () =>
          !transcribing.current &&
          ((!generating.current && !speaking.current) ||
            settings.voice.bargeIn),
        start: () => {
          if (microphone.current !== mic || !active.current) return;
          capturing.current = true;
          if (voice.vadEnabled) void interrupt();
          restingPhase();
        },
        utterance: (wav) => {
          if (microphone.current !== mic || !active.current) return;
          capturing.current = false;
          transcribing.current = true;
          restingPhase();
          if (!voice.vadEnabled) {
            microphone.current = null;
            setMicOn(false);
          }
          const token = generation.current;
          void (async () => {
            try {
              await interrupting.current;
              if (token !== generation.current) return;
              const text = await bridge.transcribe(wav, "audio/wav");
              if (token !== generation.current || !active.current) return;
              transcribing.current = false;
              if (text.trim()) await send(text);
              else {
                keyboardCapture.current = false;
                restingPhase();
              }
            } catch (err) {
              if (token === generation.current) {
                report(err);
                transcribing.current = false;
                keyboardCapture.current = false;
                restingPhase();
              }
            }
          })();
        },
        error: (err) => {
          if (microphone.current !== mic) return;
          report(err);
          closeMicrophone();
          restingPhase();
        },
        ended: () => {
          if (microphone.current === mic) {
            microphone.current = null;
            capturing.current = false;
            setMicOn(false);
            keyboardCapture.current = false;
          }
          if (ptt) {
            localKeys.current?.settled();
            void bridge.pttSettled().catch(() => {});
          }
          if (active.current) restingPhase();
        },
      },
      ptt,
    );
    microphone.current = mic;
    setMicOn(true);
    restingPhase();
    try {
      await interrupted;
      if (
        microphone.current !== mic ||
        token !== generation.current ||
        !active.current
      ) {
        mic.close();
        return;
      }
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
    setDraftBusy: (value: boolean) => {
      draftBusy.current = value;
      heartbeat();
    },
  };
}
