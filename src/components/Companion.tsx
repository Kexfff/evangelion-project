import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  MessageCircle,
  Mic,
  Minus,
  Paperclip,
  Plus,
  Settings2,
  Square,
  Volume2,
  X,
} from "lucide-react";
import { Avatar } from "./Avatar";
import { bridge } from "../bridge";
import { useCompanion } from "../useCompanion";
import { readImage } from "../images";
import {
  IMAGE_ACCEPT,
  MAX_IMAGES,
  type ImageAttachment,
} from "../shared/images";

function MessageImages({ images }: { images?: ImageAttachment[] }) {
  if (!images?.length) return null;
  return (
    <div className="message-images">
      {images.map((image, index) => (
        <img
          key={index}
          src={image.dataUrl}
          alt={image.name}
          title={image.name}
          loading="lazy"
        />
      ))}
    </div>
  );
}

export function Companion() {
  const app = useCompanion();
  const [text, setText] = useState("");
  const [history, setHistory] = useState(false);
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [readingImages, setReadingImages] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const draftVersion = useRef(0);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ++draftVersion.current;
    setImages([]);
    setReadingImages(false);
    return () => {
      ++draftVersion.current;
    };
  }, [app.state?.sessionId, app.state?.settings.activeCharacterId]);
  async function attach(files: File[]) {
    if (!files.length || readingImages) return;
    if (images.length + files.length > MAX_IMAGES) {
      app.report(`Attach up to ${MAX_IMAGES} images per message.`);
      return;
    }
    const version = ++draftVersion.current;
    setReadingImages(true);
    try {
      const next = await Promise.all(files.map(readImage));
      if (draftVersion.current === version) {
        setImages((old) => [...old, ...next]);
        app.setError("");
      }
    } catch (err) {
      if (draftVersion.current === version) app.report(err);
    } finally {
      if (draftVersion.current === version) setReadingImages(false);
    }
  }
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
    if ((!text.trim() && !images.length) || readingImages) return;
    const message = text;
    setText("");
    setImages([]);
    ++draftVersion.current;
    void app.send(message, images);
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
                <MessageImages images={m.images} />
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
                (last ? last.content || "Image attached" : "") ||
                `Hey, I’m ${character.name}. What’s on your mind?`}
            </p>
            {!app.partial && <MessageImages images={last?.images} />}
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
        {(images.length > 0 || readingImages) && (
          <div className="attachment-tray" aria-label="Image attachments">
            {images.map((image, index) => (
              <div className="attachment-preview" key={index}>
                <img src={image.dataUrl} alt={`Attached: ${image.name}`} />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove ${image.name}`}
                  disabled={readingImages}
                  onClick={() =>
                    setImages((old) => old.filter((_, i) => i !== index))
                  }
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            <small>
              {readingImages
                ? "Reading images…"
                : "Sent to your LLM · vision model required"}
            </small>
          </div>
        )}
        <form
          className="composer"
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files).filter((file) =>
              file.type.startsWith("image/"),
            );
            if (files.length) {
              event.preventDefault();
              void attach(files);
            }
          }}
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
            ref={fileInput}
            type="file"
            accept={IMAGE_ACCEPT}
            multiple
            hidden
            aria-label="Choose images"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              void attach(files);
            }}
          />
          <button
            type="button"
            className="icon-button"
            aria-label="Attach images"
            title="Attach images (PNG, JPEG, WebP, GIF; up to 4, 2 MB each)"
            disabled={readingImages || images.length >= MAX_IMAGES}
            onClick={() => fileInput.current?.click()}
          >
            <Paperclip size={19} />
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
          {app.phase !== "idle" && !text.trim() && !images.length ? (
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
              disabled={readingImages || (!text.trim() && !images.length)}
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
