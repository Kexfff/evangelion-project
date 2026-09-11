import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  MessageCircle,
  Mic,
  Minus,
  Plus,
  Settings2,
  Square,
  Volume2,
  X,
} from "lucide-react";
import { Avatar } from "./Avatar";
import { bridge } from "../bridge";
import { useCompanion } from "../useCompanion";

export function Companion() {
  const app = useCompanion();
  const [text, setText] = useState("");
  const [history, setHistory] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [app.state?.messages.length, app.partial, history]);
  if (!app.state)
    return <div className="boot">{app.error || "Waking up…"}</div>;
  const { settings, messages } = app.state;
  const character = settings.characters.find(
    (c) => c.id === settings.activeCharacterId,
  )!;
  const busy =
    app.phase === "thinking" || app.phase === "transcribing" || app.state.busy;
  const last = messages.at(-1);
  const submit = () => {
    if (!text.trim()) return;
    const message = text;
    setText("");
    void app.send(message);
  };
  return (
    <main className="companion-window">
      <header className="companion-title">
        <div className="companion-name">
          <span className={`status-dot ${app.phase}`} />
          {character.name}
          <span className="phase-label">
            {app.phase === "idle" ? "here with you" : `${app.phase}…`}
          </span>
        </div>
        <div className="window-controls">
          <button
            title="Settings"
            aria-label="Open settings"
            onClick={() => void bridge.openSettings().catch(app.report)}
          >
            <Settings2 size={16} />
          </button>
          <button
            title="Minimize"
            aria-label="Minimize"
            onClick={() => void bridge.windowAction("minimize")}
          >
            <Minus size={16} />
          </button>
          <button
            title="Close avatar"
            aria-label="Close avatar"
            onClick={() => void bridge.windowAction("close")}
          >
            <X size={16} />
          </button>
        </div>
      </header>
      {bridge.preview && (
        <div className="preview-pill">
          Browser preview · desktop features require npm run dev
        </div>
      )}
      <div className="companion-stage">
        <Avatar
          avatar={character.avatar}
          settings={settings.vrm}
          speaking={app.phase === "speaking"}
          amplitude={app.amplitude}
        />
      </div>
      <div className="conversation-overlay">
        {history && (
          <section className="history-panel">
            <div className="panel-heading">
              <span>Our conversation</span>
              <button
                className="icon-button"
                title="New conversation; keep memories"
                disabled={busy}
                onClick={() => void bridge.newSession().catch(app.report)}
              >
                <Plus size={16} />
              </button>
            </div>
            {!messages.length && (
              <p className="muted">A fresh conversation. Say hello.</p>
            )}
            {messages.map((m) => (
              <div className={`chat-message ${m.role}`} key={m.id}>
                <small>{m.role === "user" ? "You" : character.name}</small>
                <p>{m.content}</p>
                {m.role === "assistant" && settings.providers.tts.enabled && (
                  <button
                    className="icon-button"
                    title="Read aloud"
                    disabled={busy}
                    onClick={() => void app.speak(m.content)}
                  >
                    <Volume2 size={13} />
                  </button>
                )}
              </div>
            ))}
            {app.partial && (
              <div className="chat-message assistant">
                <small>{character.name}</small>
                <p>
                  {app.partial}
                  <span className="cursor" />
                </p>
              </div>
            )}
            <div ref={end} />
          </section>
        )}
        {!history && (
          <div className="speech-bubble">
            <small>
              {app.partial
                ? character.name
                : last
                  ? last.role === "user"
                    ? "You"
                    : character.name
                  : "A NEW CONNECTION"}
            </small>
            <p>
              {app.partial ||
                last?.content ||
                `Hey, I’m ${character.name}. What’s on your mind?`}
            </p>
          </div>
        )}
        {app.error && (
          <div className="inline-error" role="alert">
            {app.error}
            <button aria-label="Dismiss error" onClick={() => app.setError("")}>
              <X size={14} />
            </button>
          </div>
        )}
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <button
            type="button"
            className={`icon-button ${history ? "selected" : ""}`}
            title="Conversation history"
            aria-label="Toggle conversation history"
            onClick={() => setHistory(!history)}
          >
            <MessageCircle size={19} />
          </button>
          <input
            aria-label="Message Eva"
            placeholder={
              app.micOn
                ? settings.voice.vadEnabled
                  ? "Hands-free listening…"
                  : "Listening… tap mic to finish"
                : `Talk to ${character.name}…`
            }
            value={text}
            maxLength={8000}
            onChange={(e) => setText(e.target.value)}
            disabled={app.micOn && !settings.voice.vadEnabled}
          />
          <button
            type="button"
            aria-label={
              app.micOn
                ? settings.voice.vadEnabled
                  ? "Stop hands-free listening"
                  : "Finish recording"
                : "Start recording"
            }
            title={
              settings.voice.vadEnabled
                ? "Toggle hands-free listening"
                : "Click to record; click again to send"
            }
            className={`icon-button ${app.micOn ? "recording" : ""}`}
            onClick={() => void app.toggleRecording()}
          >
            <Mic size={19} />
          </button>
          {app.phase !== "idle" && !text.trim() ? (
            <button
              type="button"
              className="send-button"
              title="Stop"
              aria-label="Stop response"
              onClick={() => void app.stop()}
            >
              <Square size={15} />
            </button>
          ) : (
            <button
              className="send-button"
              aria-label="Send message"
              disabled={!text.trim()}
            >
              <ArrowUp size={19} />
            </button>
          )}
        </form>
        {app.micOn && (
          <meter
            className="mic-meter companion-meter"
            aria-label="Microphone level"
            min={0}
            max={0.3}
            value={app.micLevel}
          />
        )}
        <div className="companion-footnote">
          {app.micOn
            ? settings.voice.vadEnabled
              ? "Hands-free mic on · pause to send · click mic to stop"
              : "Microphone on · up to 60 seconds"
            : "A little more present, every conversation."}
        </div>
      </div>
    </main>
  );
}
