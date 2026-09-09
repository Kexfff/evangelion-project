import { useEffect, useRef, useState } from "react";
import { bridge } from "./bridge";
import type { Phase, Snapshot } from "./shared/schema";

export function useCompanion() {
  const [state, setState] = useState<Snapshot>();
  const [phase, setPhase] = useState<Phase>("idle");
  const [partial, setPartial] = useState("");
  const [error, setError] = useState("");
  const [amplitude, setAmplitude] = useState(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const audioUrl = useRef("");
  const frame = useRef(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const recordingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const generation = useRef(0);
  const active = useRef(true);
  const localBusy = useRef(false);
  const sessionKey = useRef("");
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
  function stopAudio() {
    if (audio.current) {
      audio.current.pause();
      audio.current.src = "";
      audio.current = null;
    }
    if (audioUrl.current) {
      URL.revokeObjectURL(audioUrl.current);
      audioUrl.current = "";
    }
    if (audioContext.current) {
      void audioContext.current.close().catch(() => {});
      audioContext.current = null;
    }
    cancelAnimationFrame(frame.current);
    setAmplitude(0);
  }
  useEffect(() => {
    active.current = true;
    void bridge
      .snapshot()
      .then((s) => {
        if (active.current) {
          sessionKey.current = `${s.settings.activeCharacterId}:${s.sessionId}`;
          setState(s);
        }
      })
      .catch(report);
    const off = bridge.onEvent((event) => {
      if (event.type === "state") {
        const key = `${event.state.settings.activeCharacterId}:${event.state.sessionId}`;
        if (sessionKey.current && sessionKey.current !== key) void stop();
        sessionKey.current = key;
        setState(event.state);
        if (!event.state.busy) setPartial("");
      } else if (event.type === "delta") setPartial((p) => p + event.text);
      else if (event.type === "warning") setError(event.message);
      else if (event.type === "phase") setPhase(event.phase);
    });
    return () => {
      active.current = false;
      off();
      generation.current++;
      clearTimeout(recordingTimer.current);
      if (recorder.current) {
        recorder.current.onstop = null;
        recorder.current.stream.getTracks().forEach((t) => t.stop());
        if (recorder.current.state !== "inactive") recorder.current.stop();
      }
      stopAudio();
    };
  }, []);
  async function speak(text: string, token = ++generation.current) {
    stopAudio();
    setError("");
    setPhase("speaking");
    // Open the context within the originating user gesture when available.
    const context = new AudioContext();
    audioContext.current = context;
    void context.resume().catch(() => {});
    try {
      const bytes = await bridge.speak(text);
      if (token !== generation.current || !active.current) return;
      const url = URL.createObjectURL(
        new Blob([bytes], { type: "audio/mpeg" }),
      );
      audioUrl.current = url;
      const player = new Audio(url);
      audio.current = player;
      player.volume = state?.settings.voice.volume ?? 0.8;
      const source = context.createMediaElementSource(player);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyser.connect(context.destination);
      const values = new Uint8Array(analyser.fftSize);
      const sample = () => {
        analyser.getByteTimeDomainData(values);
        setAmplitude(
          Math.sqrt(
            values.reduce((sum, v) => sum + ((v - 128) / 128) ** 2, 0) /
              values.length,
          ),
        );
        frame.current = requestAnimationFrame(sample);
      };
      player.onended = () => {
        if (token === generation.current) {
          stopAudio();
          setPhase("idle");
        }
      };
      player.onerror = () => {
        if (token === generation.current) {
          stopAudio();
          setPhase("idle");
          report(
            new Error(
              "Could not decode speech audio. Use a provider that returns MP3.",
            ),
          );
        }
      };
      await context.resume();
      await player.play();
      sample();
    } catch (err) {
      if (token === generation.current) {
        report(err);
        stopAudio();
        setPhase("idle");
      }
    }
  }
  async function send(text: string) {
    if (!text.trim() || localBusy.current || state?.busy) return;
    localBusy.current = true;
    const token = ++generation.current;
    stopAudio();
    setError("");
    setPartial("");
    setPhase("thinking");
    try {
      await bridge.send(text.trim());
      if (token !== generation.current) return;
      const next = await bridge.snapshot();
      setState(next);
      const last = next.messages.at(-1);
      if (
        next.settings.voice.autoSpeak &&
        next.settings.providers.tts.enabled &&
        last?.role === "assistant"
      )
        await speak(last.content, token);
      else setPhase("idle");
    } catch (err) {
      if (token === generation.current) {
        report(err);
        setPhase("idle");
      }
    } finally {
      localBusy.current = false;
    }
  }
  async function stop() {
    generation.current++;
    stopAudio();
    clearTimeout(recordingTimer.current);
    if (recorder.current) {
      recorder.current.onstop = null;
      if (recorder.current.state !== "inactive") recorder.current.stop();
      recorder.current.stream.getTracks().forEach((t) => t.stop());
      recorder.current = null;
    }
    await bridge.cancel().catch(report);
    setPhase("idle");
    setPartial("");
  }
  async function toggleRecording() {
    if (recorder.current?.state === "recording") {
      recorder.current.stop();
      return;
    }
    if (localBusy.current || state?.busy) return;
    if (!state?.settings.providers.asr.enabled) {
      report(
        new Error("Enable speech recognition in Settings → Providers first."),
      );
      return;
    }
    await stop();
    setError("");
    const token = generation.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (token !== generation.current || !active.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(
        (t) => MediaRecorder.isTypeSupported(t),
      );
      const recording = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined,
      );
      recorder.current = recording;
      const chunks: Blob[] = [];
      recording.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recording.onstop = async () => {
        clearTimeout(recordingTimer.current);
        stream.getTracks().forEach((t) => t.stop());
        recorder.current = null;
        if (token !== generation.current) return;
        setPhase("transcribing");
        localBusy.current = true;
        try {
          const blob = new Blob(chunks, { type: recording.mimeType });
          const text = await bridge.transcribe(
            await blob.arrayBuffer(),
            recording.mimeType,
          );
          localBusy.current = false;
          if (token === generation.current) await send(text);
        } catch (err) {
          if (token === generation.current) {
            report(err);
            setPhase("idle");
          }
        } finally {
          localBusy.current = false;
        }
      };
      recording.onerror = () => {
        report(new Error("Microphone recording failed."));
        void stop();
      };
      recording.start();
      setPhase("listening");
      recordingTimer.current = setTimeout(() => {
        if (recording.state === "recording") recording.stop();
      }, 60000);
    } catch (err) {
      report(err);
      setPhase("idle");
    }
  }
  return {
    state,
    phase,
    partial,
    error,
    setError,
    amplitude,
    send,
    stop,
    speak,
    toggleRecording,
    report,
  };
}
