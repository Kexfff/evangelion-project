import { useEffect, useRef, useState } from "react";
import { ChevronRight, Mic, RefreshCw, Square, Volume2 } from "lucide-react";
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
        {hint && <small id={`${key}-hint`}>{hint}</small>}
      </div>
      <input
        type="checkbox"
        className="toggle"
        aria-label={label}
        aria-describedby={hint ? `${key}-hint` : undefined}
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
  const msRange = (
    key: "vadSilenceMs" | "vadMinSpeechMs",
    label: string,
    min: number,
    max: number,
    step: number,
    hint: string,
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
          value={voice[key]}
          onChange={(e) => change({ [key]: Number(e.target.value) })}
        />
        <output>{(voice[key] / 1000).toFixed(1)} s</output>
      </div>
      <small>{hint}</small>
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
          <section className="card">
            <div className="section-heading">
              <h2>How you talk to her</h2>
              <p>Speak hands-free, or hold a key while you talk.</p>
            </div>
            {toggle(
              "vadEnabled",
              "Hands-free voice detection",
              voice.ptt.enabled
                ? "Paused while keyboard voice control is on below."
                : "Click the microphone in her window to start listening. She replies after you pause; click again to stop.",
            )}
            {toggle(
              "bargeIn",
              "Interrupt when I speak",
              "Talking stops her reply. When off, press-to-talk waits until she finishes. Headphones help avoid her hearing herself.",
            )}
            {msRange(
              "vadSilenceMs",
              "Pause before sending",
              300,
              3000,
              100,
              "How long a silence ends what you’re saying.",
            )}
            <label className="field">
              <span>Recognition language</span>
              <input
                aria-label="Recognition language"
                value={voice.language}
                placeholder="Detect automatically"
                maxLength={20}
                onChange={(e) => change({ language: e.target.value })}
              />
              <small>Optional language code, like en, ru or ja.</small>
            </label>
          </section>
          <PushToTalkSettings
            config={voice.ptt}
            change={(ptt) => change({ ptt })}
          />
        </div>
        <div>
          <section className="card">
            <div className="section-heading">
              <h2>Her speaking voice</h2>
              <p>How and where she speaks her replies.</p>
            </div>
            {toggle("autoSpeak", "Speak replies automatically")}
            {deviceSelect(
              "outputDeviceId",
              "audiooutput",
              "Speakers / headphones",
            )}
            <div className="button-row field-actions">
              <button
                className="button secondary"
                onClick={() => void testOutput()}
              >
                <Volume2 size={14} />
                Play a test tone
              </button>
            </div>
            {range("speed", "Voice speed", 0.5, 2, 0.05)}
            {range("volume", "Playback volume", 0, 1, 0.05)}
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
                {voice.sentenceBuffering
                  ? voice.speechChunking === "line"
                    ? "Waits for each line break, keeping short sentences together. Can sound smoother with local voices; without line breaks she waits for the whole reply."
                    : "She starts talking as soon as the first sentence is ready."
                  : "She waits for the whole reply before speaking."}
              </small>
            </label>
          </section>
          <section className="card">
            <div className="section-heading">
              <h2>Microphone</h2>
              <p>
                If she misses quiet speech, raise the gain or lower the
                detection threshold.
              </p>
            </div>
            {deviceSelect("inputDeviceId", "audioinput", "Microphone")}
            {range("inputGain", "Microphone gain", 0.1, 5, 0.1)}
            {range(
              "vadThreshold",
              "Voice detection threshold",
              0.005,
              0.3,
              0.005,
            )}
            <div className="mic-test">
              <meter
                className="mic-meter"
                aria-label="Microphone level"
                min={0}
                max={0.3}
                low={voice.vadThreshold}
                optimum={0.3}
                value={level}
              />
              <small>
                {testing
                  ? level >= voice.vadThreshold
                    ? "Hearing you"
                    : "Listening… speak to see the level"
                  : "Test to see your level against the threshold"}
              </small>
            </div>
            <div className="button-row">
              <button
                className="button secondary"
                onClick={() => void testMic()}
              >
                {testing ? <Square size={14} /> : <Mic size={14} />}
                {testing ? "Stop microphone test" : "Test microphone"}
              </button>
              <button
                className="button secondary"
                onClick={() => void refresh(true)}
                title="Asks for microphone permission so device names can be shown"
              >
                <RefreshCw size={14} />
                Refresh devices
              </button>
            </div>
            <p className="muted">
              Tests stay on this computer and use the unsaved settings on this
              page. Nothing is transcribed.
            </p>
            {toggle("echoCancellation", "Echo cancellation")}
            {toggle("noiseSuppression", "Noise suppression")}
            {toggle(
              "autoGainControl",
              "Automatic gain control",
              "Leave off for predictable manual sensitivity.",
            )}
          </section>
          <details className="card fine-tuning">
            <summary>
              <div className="section-heading">
                <h2>Fine-tuning</h2>
                <p>
                  Detection engine and streaming. The defaults suit most setups.
                </p>
              </div>
              <ChevronRight size={18} />
            </summary>
            <label className="field">
              <span>Speech detector</span>
              <select
                value={voice.vadEngine}
                onChange={(e) =>
                  change({ vadEngine: e.target.value as "energy" | "silero" })
                }
              >
                <option value="energy">Audio energy · lightweight</option>
                <option value="silero">Silero neural VAD · local</option>
              </select>
              <small>
                The neural detector tells speech from most other noises (not one
                voice from another). Press-to-talk still uses a quick energy
                check to ignore accidental taps.
              </small>
            </label>
            {voice.vadEngine === "silero" &&
              range(
                "neuralThreshold",
                "Speech probability threshold",
                0.1,
                0.95,
                0.05,
              )}
            {msRange(
              "vadMinSpeechMs",
              "Minimum voice duration",
              100,
              1000,
              50,
              "Shorter sounds than this are ignored.",
            )}
            {toggle(
              "transcriptionStreaming",
              "Stream recognition text",
              "Shows your words while they’re recognized, if your speech service streams results (SSE). If it rejects the option, turn this off.",
            )}
            {toggle(
              "streaming",
              "Stream speech audio",
              "Starts playing MP3 audio while it downloads. Other formats play once complete.",
            )}
            <p className="muted">
              Listening runs on this computer. Each recording is capped at 60
              seconds and sent as 16 kHz mono audio.
            </p>
          </details>
        </div>
      </div>
    </>
  );
}
