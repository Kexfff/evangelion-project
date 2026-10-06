import { useEffect, useRef, useState } from "react";
import { Mic, RefreshCw, Square } from "lucide-react";
import type { Settings } from "../shared/schema";
import { MicrophoneCapture } from "../audio/microphone";
import { routeOutput } from "../audio/playback";
import { PushToTalkSettings } from "./PushToTalkSettings";
import { bridge } from "../bridge";

export function VoiceSettings({
  voice,
  change,
}: {
  voice: Settings["voice"];
  change: (patch: Partial<Settings["voice"]>) => void;
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState("");
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const capture = useRef<MicrophoneCapture | null>(null);
  const refresh = async (permission = false) => {
    setError("");
    try {
      if (permission) {
        const id = crypto.randomUUID();
        if (!(await bridge.microphoneLease(id, true)))
          throw new Error(
            "Stop the current recording or microphone test before refreshing device permissions.",
          );
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
          });
          stream.getTracks().forEach((t) => t.stop());
        } finally {
          await bridge.microphoneLease(id, false);
        }
      }
      setDevices(await navigator.mediaDevices.enumerateDevices());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const stop = () => {
    capture.current?.close();
    capture.current = null;
    setTesting(false);
    setLevel(0);
  };
  useEffect(() => {
    void refresh();
    const off = bridge.onEvent((event) => {
      if (event.type === "ptt-action" && event.action === "cancel") stop();
    });
    const changed = () => void refresh();
    navigator.mediaDevices?.addEventListener("devicechange", changed);
    return () => {
      off();
      capture.current?.close();
      navigator.mediaDevices?.removeEventListener("devicechange", changed);
    };
  }, []);
  useEffect(() => {
    stop();
  }, [voice]);
  const testMic = async () => {
    if (capture.current) {
      stop();
      return;
    }
    setError("");
    setTesting(true);
    const mic = new MicrophoneCapture(
      { ...voice, vadEnabled: true },
      {
        level: (value) => {
          if (capture.current === mic) setLevel(value);
        },
        start: () => {},
        utterance: () => {},
        acceptsSpeech: () => true,
        error: (err) => {
          if (capture.current !== mic) return;
          setError(err.message);
          stop();
        },
      },
    );
    capture.current = mic;
    try {
      await mic.open();
    } catch (err) {
      if (capture.current === mic) {
        setError(err instanceof Error ? err.message : String(err));
        stop();
      }
    }
  };
  const testOutput = async () => {
    const context = new AudioContext();
    try {
      await routeOutput(context, voice.outputDeviceId);
      await context.resume();
      const tone = context.createOscillator(),
        gain = context.createGain();
      tone.frequency.value = 440;
      gain.gain.value = voice.volume * 0.1;
      tone.connect(gain);
      gain.connect(context.destination);
      tone.start();
      tone.stop(context.currentTime + 0.25);
      await new Promise<void>((resolve) => {
        tone.onended = () => resolve();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      await context.close().catch(() => {});
    }
  };
  const toggle = (
    key: keyof Settings["voice"],
    label: string,
    hint?: string,
  ) => (
    <label className="toggle-row">
      <div>
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <input
        type="checkbox"
        className="toggle"
        checked={Boolean(voice[key])}
        onChange={(e) => change({ [key]: e.target.checked })}
      />
    </label>
  );
  const range = (
    key: keyof Settings["voice"],
    label: string,
    min: number,
    max: number,
    step: number,
  ) => (
    <label className="field">
      <span>{label}</span>
      <div className="range">
        <input
          aria-label={label}
          type="range"
          min={min}
          max={max}
          step={step}
          value={Number(voice[key])}
          onChange={(e) => change({ [key]: Number(e.target.value) })}
        />
        <output>{Number(Number(voice[key]).toFixed(3))}</output>
      </div>
    </label>
  );
  const deviceSelect = (
    key: "inputDeviceId" | "outputDeviceId",
    kind: MediaDeviceKind,
    label: string,
  ) => (
    <label className="field">
      <span>{label}</span>
      <select
        aria-label={label}
        value={voice[key]}
        onChange={(e) => change({ [key]: e.target.value })}
      >
        <option value="">System default</option>
        {devices
          .filter(
            (d) => d.kind === kind && d.deviceId && d.deviceId !== "default",
          )
          .map((d, i) => (
            <option value={d.deviceId} key={d.deviceId}>
              {d.label || `${label} ${i + 1}`}
            </option>
          ))}
        {voice[key] && !devices.some((d) => d.deviceId === voice[key]) && (
          <option value={voice[key]}>Saved device (unavailable)</option>
        )}
      </select>
    </label>
  );
  return (
    <>
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      <div className="two-column">
        <div>
          <PushToTalkSettings
            config={voice.ptt}
            change={(ptt) => change({ ptt })}
          />
          <section className="card">
            <div className="section-heading">
              <h2>Input & output devices</h2>
              <p>
                Refresh with microphone permission to show device names. Tests
                use the unsaved settings on this page.
              </p>
            </div>
            {deviceSelect("inputDeviceId", "audioinput", "Microphone")}
            {deviceSelect(
              "outputDeviceId",
              "audiooutput",
              "Speakers / headphones",
            )}
            <div className="button-row">
              <button
                className="button secondary"
                onClick={() => void refresh(true)}
              >
                <RefreshCw size={14} />
                Refresh devices
              </button>
              <button
                className="button secondary"
                onClick={() => void testOutput()}
              >
                Test output
              </button>
            </div>
          </section>
          <section className="card">
            <div className="section-heading">
              <h2>Microphone sensitivity</h2>
              <p>
                Raise input gain for a quiet microphone. Lower the voice
                threshold to detect softer speech.
              </p>
            </div>
            {range("inputGain", "Microphone gain", 0.1, 5, 0.1)}
            {range(
              "vadThreshold",
              "Voice detection threshold",
              0.005,
              0.3,
              0.005,
            )}
            <meter
              className="mic-meter"
              aria-label="Microphone level"
              min={0}
              max={0.3}
              value={level}
            />
            <small>
              Level {level.toFixed(3)} · threshold{" "}
              {voice.vadThreshold.toFixed(3)}
            </small>
            <button
              className="button secondary full"
              onClick={() => void testMic()}
            >
              {testing ? <Square size={14} /> : <Mic size={14} />}{" "}
              {testing ? "Stop microphone test" : "Test microphone"}
            </button>
            <p className="muted">
              Microphone tests stay on this device and are not transcribed.
            </p>
            {toggle("echoCancellation", "Echo cancellation")}
            {toggle("noiseSuppression", "Noise suppression")}
            {toggle(
              "autoGainControl",
              "Automatic gain control",
              "Leave off for predictable manual sensitivity.",
            )}
          </section>
        </div>
        <div>
          <section className="card">
            <div className="section-heading">
              <h2>Natural conversation</h2>
            </div>
            {toggle(
              "vadEnabled",
              "Hands-free voice detection",
              voice.ptt.enabled
                ? "Paused while keyboard voice control is enabled. Disable keyboard control to use hands-free listening."
                : "Click the companion microphone to enable listening. Speech is sent after a pause; click again to turn it off.",
            )}
            {range("vadSilenceMs", "Pause before sending (ms)", 300, 3000, 100)}
            {range(
              "vadMinSpeechMs",
              "Minimum voice duration (ms)",
              100,
              1000,
              50,
            )}
            {toggle(
              "bargeIn",
              "Interrupt when I speak",
              "Your press-to-talk key or hands-free speech stops her reply. When off, press-to-talk waits until she finishes. Headphones reduce feedback.",
            )}
            <label className="field">
              <span>Recognition language</span>
              <input
                aria-label="Recognition language"
                value={voice.language}
                placeholder="Auto detect"
                maxLength={20}
                onChange={(e) => change({ language: e.target.value })}
              />
              <small>Optional language code: en, ru, ja…</small>
            </label>
            <p className="muted">
              Voice activity detection runs locally using audio energy and
              configurable timing. Each utterance is limited to 60 seconds and
              sent as a 16 kHz mono WAV.
            </p>
          </section>
          <section className="card">
            <div className="section-heading">
              <h2>Speech playback</h2>
            </div>
            {toggle("autoSpeak", "Speak replies automatically")}
            <label className="field">
              <span>Speech delivery</span>
              <select
                aria-label="Speech delivery"
                value={
                  voice.sentenceBuffering ? voice.speechChunking : "response"
                }
                onChange={(event) => {
                  const mode = event.target.value;
                  change({
                    sentenceBuffering: mode !== "response",
                    speechChunking: mode === "line" ? "line" : "sentence",
                  });
                }}
              >
                <option value="sentence">Sentence by sentence</option>
                <option value="line">Line by line</option>
                <option value="response">Full response</option>
              </select>
              <small>
                Line by line keeps short sentences together until a newline,
                which can help local TTS. Without a newline it waits for the
                reply to finish. Full response waits for the entire reply. Audio
                streaming works independently of this setting.
              </small>
            </label>
            {toggle(
              "streaming",
              "Stream speech audio",
              "Play incoming MP3 bytes immediately when the provider streams them. Unsupported containers fall back to buffered playback.",
            )}
            {range("speed", "Voice speed", 0.5, 2, 0.05)}
            {range("volume", "Playback volume", 0, 1, 0.05)}
          </section>
        </div>
      </div>
    </>
  );
}
