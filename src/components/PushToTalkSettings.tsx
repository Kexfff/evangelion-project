import { useEffect, useRef, useState } from "react";
import { Keyboard, X } from "lucide-react";
import { bridge } from "../bridge";
import {
  pttKey,
  pttLabel,
  pttMatches,
  pttModifiers,
  type PttConfig,
  type PttStatus,
} from "../shared/ptt";

export function PushToTalkSettings({
  config,
  change,
}: {
  config: PttConfig;
  change: (config: PttConfig) => void;
}) {
  const [binding, setBinding] = useState(false);
  const [status, setStatus] = useState<PttStatus>();
  const [saved, setSaved] = useState<PttConfig>();
  const [localEdge, setLocalEdge] = useState("");
  const [error, setError] = useState("");
  const current = useRef(config);
  const modifier = useRef("");
  current.current = config;
  const dirty = JSON.stringify(saved) !== JSON.stringify(config);
  const run = (work: Promise<unknown>) => {
    setError("");
    void work.catch((e: Error) => setError(e.message));
  };
  useEffect(() => {
    void bridge
      .pttStatus()
      .then(setStatus)
      .catch(() => {});
    void bridge.snapshot().then((s) => setSaved(s.settings.voice.ptt));
    const off = bridge.onEvent((event) => {
      if (event.type === "ptt-status") setStatus(event.status);
      if (event.type === "state") setSaved(event.state.settings.voice.ptt);
    });
    return () => {
      off();
      void bridge.pttTest(false).catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (!status?.testing || config.scope !== "app") return;
    const down = (e: KeyboardEvent) => {
      if (!e.repeat && pttMatches(e, current.current)) {
        e.preventDefault();
        setLocalEdge("pressed");
      }
    };
    const up = (e: KeyboardEvent) => {
      if (pttKey(e) === current.current.key) setLocalEdge("released");
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [status?.testing, config.scope]);
  return (
    <section className="card ptt-card">
      <div className="section-heading">
        <h2>
          <Keyboard size={18} /> Press to talk
        </h2>
        <p>
          A key for your voice. Hold, speak, release—or choose
          press-again-to-send.
        </p>
      </div>
      <label className="toggle-row">
        <div>
          <span>Keyboard voice control</span>
          <small>
            Replaces hands-free VAD while enabled. No audio is captured before
            you press.
          </small>
        </div>
        <input
          aria-label="Keyboard voice control"
          className="toggle"
          type="checkbox"
          checked={config.enabled}
          disabled={!config.key}
          onChange={(e) => change({ ...config, enabled: e.target.checked })}
        />
      </label>
      <div className="ptt-binding-row">
        <button
          type="button"
          className={`button secondary ptt-binding ${binding ? "recording" : ""}`}
          aria-label="Set press-to-talk key"
          onClick={() => {
            modifier.current = "";
            setBinding(true);
            void bridge.pttTest(false).catch(() => {});
          }}
          onBlur={() => setBinding(false)}
          onKeyDown={(e) => {
            if (!binding) return;
            e.preventDefault();
            e.stopPropagation();
            if (e.key === "Escape") {
              setBinding(false);
              return;
            }
            const key = pttKey(e.nativeEvent);
            if (!key || e.repeat || e.nativeEvent.isComposing) return;
            if (/^(Shift|Control|Alt|Meta)/.test(key)) {
              modifier.current = key;
              return;
            }
            change({ ...config, key, ...pttModifiers(e.nativeEvent, key) });
            setBinding(false);
          }}
          onKeyUp={(e) => {
            if (
              !binding ||
              !modifier.current ||
              pttKey(e.nativeEvent) !== modifier.current
            )
              return;
            e.preventDefault();
            e.stopPropagation();
            const key = modifier.current;
            change({ ...config, key, ...pttModifiers(e.nativeEvent, key) });
            modifier.current = "";
            setBinding(false);
          }}
        >
          <Keyboard size={16} />
          {binding
            ? "Press a key… Esc to cancel"
            : config.key
              ? pttLabel(config)
              : "Choose a key"}
        </button>
        <button
          className="icon-button"
          aria-label="Clear press-to-talk key"
          disabled={!config.key}
          onClick={() => {
            change({ ...config, key: "", enabled: false });
            setBinding(false);
          }}
        >
          <X size={16} />
        </button>
      </div>
      <small>
        Letters, numbers, F1–F24, Space, Backquote or a left/right modifier
        (including Right Shift). Choose a key that does not conflict with your
        game. App mode uses physical keys; the desktop controls global layout
        and assignments.
      </small>
      <label className="field">
        <span>Key behavior</span>
        <select
          aria-label="Key behavior"
          value={config.mode}
          onChange={(e) =>
            change({ ...config, mode: e.target.value as PttConfig["mode"] })
          }
        >
          <option value="hold">Hold to talk · release to send</option>
          <option value="toggle">Press to talk · press again to send</option>
        </select>
      </label>
      <label className="field">
        <span>Shortcut scope</span>
        <select
          aria-label="Shortcut scope"
          value={config.scope}
          onChange={(e) =>
            change({ ...config, scope: e.target.value as PttConfig["scope"] })
          }
        >
          <option value="global">Global · even with Minecraft focused</option>
          <option value="app">App-focused · companion window only</option>
        </select>
      </label>
      <div className="ptt-status" role="status">
        <span
          className={`status-dot ${status?.state === "ready" ? "listening" : ""}`}
        />
        <div>
          <strong>
            {dirty
              ? "Unsaved binding"
              : status?.state === "ready"
                ? "Ready"
                : status?.state === "registering"
                  ? "Waiting for desktop"
                  : status?.state === "unavailable"
                    ? "Shortcut unavailable"
                    : status?.state === "suspended"
                      ? "Paused"
                      : "Keyboard control off"}
          </strong>
          <p>
            {dirty
              ? "Save changes to apply this key and mode."
              : status?.message}
          </p>
          {!dirty && status?.binding && (
            <small>Active binding: {status.binding}</small>
          )}
        </div>
      </div>
      <div className="button-row">
        <button
          className="button secondary"
          disabled={dirty || !config.enabled || status?.state !== "ready"}
          onClick={() => {
            setLocalEdge("");
            run(bridge.pttTest(!status?.testing));
          }}
        >
          {status?.testing
            ? "End keybind test"
            : "Test keybind (no microphone)"}
        </button>
        <button
          className="button secondary"
          disabled={
            dirty ||
            !config.enabled ||
            status?.state === "registering" ||
            bridge.preview
          }
          onClick={() => run(bridge.pttRetry())}
        >
          Retry registration
        </button>
      </div>
      {status?.testing && (
        <p className="ptt-test" role="status">
          Test only ·{" "}
          {config.scope === "app"
            ? localEdge || "press your key here"
            : status.lastEdge || "press your key in any app"}{" "}
          · microphone off · ends after 30 seconds
        </p>
      )}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <p className="muted">
        Global shortcuts use the Linux desktop portal and may need permission.
        Your desktop can assign a different key; the active binding above is
        authoritative. If unsupported, choose app-focused mode. Recordings are
        cancelled on lock, device loss or after 60 seconds. Silence and quick
        taps are discarded.
      </p>
    </section>
  );
}
