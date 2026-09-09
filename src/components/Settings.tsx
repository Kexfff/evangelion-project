import { useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  AudioLines,
  Box,
  Brain,
  Check,
  ChevronRight,
  CircleHelp,
  Cpu,
  ExternalLink,
  Heart,
  LayoutDashboard,
  MessageCircle,
  Plus,
  Puzzle,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  Volume2,
  WandSparkles,
  X,
} from "lucide-react";
import { bridge } from "../bridge";
import {
  defaultSettings,
  settingsSchema,
  type Character,
  type Fact,
  type ProviderKind,
  type Settings as AppSettings,
  type Snapshot,
} from "../shared/schema";
import { Avatar } from "./Avatar";

const navigation = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "character", label: "Character cards", icon: UserRound },
  { id: "providers", label: "Providers", icon: Cpu },
  { id: "voice", label: "Voice & audio", icon: AudioLines },
  { id: "vrm", label: "Avatar studio", icon: Box },
  { id: "memory", label: "Memory", icon: Brain },
  { id: "consciousness", label: "Consciousness", icon: Sparkles },
  { id: "plugins", label: "Plugins & MCP", icon: Puzzle },
] as const;
type Tab = (typeof navigation)[number]["id"];
const descriptions: Record<Tab, string> = {
  overview: "A home for your digital companion. Make it feel like her.",
  character: "Her identity, her perspective, her way of being.",
  providers: "Connect the services that let her listen, think, and speak.",
  voice: "Find the rhythm of your conversations.",
  vrm: "A little light. A little movement. A lot of personality.",
  memory: "The things that stay with her, long after a conversation.",
  consciousness: "The next step: a life between conversations.",
  plugins: "A foundation for a much bigger world.",
};
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="toggle-row">
      <div>
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <input
        className="toggle"
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
function Range({
  label,
  value,
  min,
  max,
  step = 0.05,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label}>
      <div className="range">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <output>{Number(value.toFixed(2))}</output>
      </div>
    </Field>
  );
}
function Section({
  title,
  subtitle,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      <div className="section-heading">
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

export function Settings() {
  const [tab, setTab] = useState<Tab>("overview");
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [draft, setDraft] = useState<AppSettings>();
  const [dirty, setDirty] = useState(false);
  const [keys, setKeys] = useState<Partial<Record<ProviderKind, string>>>({});
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [search, setSearch] = useState("");
  const [factText, setFactText] = useState("");
  const [editing, setEditing] = useState<Fact>();
  useEffect(() => {
    void bridge
      .snapshot()
      .then((s) => {
        setSnapshot(s);
        setDraft(s.settings);
      })
      .catch((err) => setError(String(err)));
    return bridge.onEvent((event) => {
      if (event.type === "state") setSnapshot(event.state);
      if (event.type === "warning") setError(event.message);
    });
  }, []);
  const update = (fn: (next: AppSettings) => void) => {
    setDraft((prev) => {
      const next = structuredClone(prev!);
      fn(next);
      return next;
    });
    setDirty(true);
    setNotice("");
  };
  const perform = async (fn: () => Promise<unknown>, success = "") => {
    setError("");
    setNotice("");
    setWorking(true);
    try {
      await fn();
      if (success) setNotice(success);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message.replace(
              /^Error invoking remote method '[^']+': (?:Error: )?/,
              "",
            )
          : String(err),
      );
    } finally {
      setWorking(false);
    }
  };
  const save = () =>
    perform(async () => {
      const valid = settingsSchema.parse(draft);
      await bridge.saveSettings(valid, keys);
      setKeys({});
      setDirty(false);
      const s = await bridge.snapshot();
      setSnapshot(s);
      setDraft(s.settings);
    }, "Settings saved. Your companion is up to date.");
  if (!draft || !snapshot)
    return (
      <div className="boot">{error || "Opening your companion’s world…"}</div>
    );
  const character = draft.characters.find(
    (c) => c.id === draft.activeCharacterId,
  )!;
  const editCharacter = (patch: Partial<Character>) =>
    update((d) => {
      Object.assign(
        d.characters.find((c) => c.id === d.activeCharacterId)!,
        patch,
      );
    });
  const persistedCharacter = snapshot.settings.characters.find(
    (c) => c.id === snapshot.settings.activeCharacterId,
  )!;
  const counts = Object.values(snapshot.settings.providers).filter(
    (p) => p.enabled,
  ).length;
  const facts = snapshot.facts.filter((f) =>
    f.text.toLowerCase().includes(search.toLowerCase()),
  );
  const launch = () => perform(() => bridge.windowAction("companion"));
  return (
    <div className="settings-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            e<span>✳</span>
          </div>
          <div>
            evangelion<span>PROJECT / 01</span>
          </div>
        </div>
        <div className="workspace-label">YOUR COMPANION</div>
        <nav>
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {(id === "consciousness" || id === "plugins") && (
                <span className="nav-soon">SOON</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-badge">
            <ShieldCheck size={16} />
            <div>
              Local by design<small>Your memories live here.</small>
            </div>
          </div>
          <button className="profile-button" onClick={launch}>
            <span className="mini-avatar">{character.name.slice(0, 1)}</span>
            <span>
              {persistedCharacter.name}
              <small>
                <i className="status-dot" />
                Companion ready
              </small>
            </span>
            <ExternalLink size={14} />
          </button>
          <div className="version">
            evangelion_project <span>v0.1.0</span>
          </div>
        </div>
      </aside>
      <div className="settings-body">
        <header className="topbar">
          <div>
            Workspace <ChevronRight size={13} />
            <span>{navigation.find((n) => n.id === tab)!.label}</span>
          </div>
          <span className="foundation-badge">
            <span className="status-dot" />
            Foundation build
          </span>
        </header>
        <main className="settings-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">MAKE YOURSELF AT HOME</div>
              <h1>
                {tab === "overview"
                  ? "Hello, this is her world."
                  : navigation.find((n) => n.id === tab)!.label}
              </h1>
              <p>{descriptions[tab]}</p>
            </div>
            <button className="button secondary" onClick={launch}>
              <MessageCircle size={16} />
              Open companion
              <ExternalLink size={13} />
            </button>
          </div>
          {bridge.preview && (
            <div className="preview-banner">
              <CircleHelp size={16} />
              Browser preview. Changes are temporary; launch the desktop app
              with <code>npm run dev</code> for chat and voice.
            </div>
          )}
          {(error || notice) && (
            <div
              className={error ? "inline-error" : "success-notice"}
              role={error ? "alert" : "status"}
            >
              {error || notice}
              <button
                aria-label="Dismiss notice"
                onClick={() => {
                  setError("");
                  setNotice("");
                }}
              >
                <X size={15} />
              </button>
            </div>
          )}

          {tab === "overview" && (
            <>
              <div className="overview-grid">
                <section className="hero-card">
                  <div className="hero-text">
                    <span className="pill">
                      <span className="status-dot" />
                      YOUR CHARACTER
                    </span>
                    <h2>
                      Meet {character.name}
                      <span>.</span>
                    </h2>
                    <p>{character.tagline}</p>
                    <div className="character-tags">
                      <span>Curious by nature</span>
                      <span>Uniquely yours</span>
                    </div>
                    <button
                      className="button light"
                      onClick={() => setTab("character")}
                    >
                      Shape her character
                      <ChevronRight size={16} />
                    </button>
                    <div className="hero-caption">
                      <Heart size={13} />
                      Every connection starts with a conversation.
                    </div>
                  </div>
                  <div className="hero-avatar">
                    <div className="orbital orbit-one" />
                    <div className="orbital orbit-two" />
                    <Avatar avatar={character.avatar} settings={draft.vrm} />
                    <span className="avatar-tag">
                      <span className="status-dot" />
                      VRM · LIVE PREVIEW
                    </span>
                  </div>
                </section>
                <section className="connection-card card">
                  <div className="section-heading">
                    <span className="eyebrow">THE CONVERSATION LOOP</span>
                    <h2>Made to connect</h2>
                    <p>Three small steps. One natural exchange.</p>
                  </div>
                  {(
                    [
                      {
                        kind: "asr",
                        title: "Listen",
                        detail: "Speech to text",
                        icon: AudioLines,
                      },
                      {
                        kind: "llm",
                        title: "Think",
                        detail: "Language & personality",
                        icon: Brain,
                      },
                      {
                        kind: "tts",
                        title: "Speak",
                        detail: "Text to speech",
                        icon: Volume2,
                      },
                    ] as const
                  ).map(({ kind, title, detail, icon: Icon }) => (
                    <button
                      className="connection-step"
                      key={kind}
                      onClick={() => setTab("providers")}
                    >
                      <span className={`step-icon ${kind}`}>
                        <Icon size={19} />
                      </span>
                      <span>
                        <strong>{title}</strong>
                        <small>{detail}</small>
                      </span>
                      <span
                        className={`connection-status ${snapshot.settings.providers[kind].enabled ? "configured" : ""}`}
                      >
                        {snapshot.settings.providers[kind].enabled
                          ? "Enabled"
                          : "Set up"}
                        <ChevronRight size={12} />
                      </span>
                    </button>
                  ))}
                  <div className="card-footnote">
                    Configure each provider independently.
                  </div>
                </section>
              </div>
              <div className="stats-grid">
                <button className="stat-card" onClick={() => setTab("memory")}>
                  <span className="stat-icon">
                    <Brain size={20} />
                  </span>
                  <div>
                    <strong>
                      {snapshot.facts.length}
                      <small>saved memories</small>
                    </strong>
                    <p>Small details, lasting connections</p>
                  </div>
                  <ChevronRight size={16} />
                </button>
                <button
                  className="stat-card"
                  onClick={() => setTab("providers")}
                >
                  <span className="stat-icon green">
                    <Activity size={20} />
                  </span>
                  <div>
                    <strong>
                      {counts}
                      <small>of 3 providers enabled</small>
                    </strong>
                    <p>Run a test to verify connectivity</p>
                  </div>
                  <ChevronRight size={16} />
                </button>
                <button className="stat-card" onClick={() => setTab("vrm")}>
                  <span className="stat-icon peach">
                    <WandSparkles size={20} />
                  </span>
                  <div>
                    <strong>
                      9<small>bundled animations</small>
                    </strong>
                    <p>A little personality in every gesture</p>
                  </div>
                  <ChevronRight size={16} />
                </button>
              </div>
              <div className="section-label">
                <h2>A space that grows with you</h2>
                <span>THE ROAD AHEAD</span>
              </div>
              <div className="roadmap-grid">
                <div className="roadmap-card">
                  <span className="sprint">02 / CONSCIOUSNESS</span>
                  <Sparkles size={22} />
                  <h3>A spark of her own</h3>
                  <p>
                    Moods, a sense of time, and conversations she starts
                    herself.
                  </p>
                  <span className="coming">Next chapter</span>
                </div>
                <div className="roadmap-card">
                  <span className="sprint">03 / CONNECTIONS</span>
                  <MessageCircle size={22} />
                  <h3>Take her with you</h3>
                  <p>
                    A Telegram connection, built on a permissioned plugin
                    system.
                  </p>
                  <span className="coming">On the horizon</span>
                </div>
                <div className="roadmap-card">
                  <span className="sprint">04 / SHARED WORLDS</span>
                  <Box size={22} />
                  <h3>Go on an adventure</h3>
                  <p>MCP tools and Minecraft. Build something together.</p>
                  <span className="coming">On the horizon</span>
                </div>
              </div>
            </>
          )}

          {tab === "character" && (
            <div className="two-column">
              <div>
                <Section
                  title="Character library"
                  subtitle="Each character has their own conversations and memories."
                >
                  <div className="character-list">
                    {draft.characters.map((c) => (
                      <button
                        className={
                          c.id === character.id
                            ? "character-option selected"
                            : "character-option"
                        }
                        key={c.id}
                        onClick={() =>
                          update((d) => {
                            d.activeCharacterId = c.id;
                          })
                        }
                      >
                        <span className="mini-avatar">
                          {c.name.slice(0, 1)}
                        </span>
                        <span>
                          {c.name}
                          <small>{c.tagline}</small>
                        </span>
                        {c.id === character.id && <Check size={16} />}
                      </button>
                    ))}
                  </div>
                  <button
                    className="button secondary full"
                    onClick={() =>
                      update((d) => {
                        const id = crypto.randomUUID();
                        d.characters.push({
                          ...structuredClone(defaultSettings.characters[0]),
                          id,
                          name: "New companion",
                        });
                        d.activeCharacterId = id;
                      })
                    }
                  >
                    <Plus size={15} />
                    New character
                  </button>
                </Section>
                <Section title="Identity & personality">
                  <Field label="Name">
                    <input
                      value={character.name}
                      maxLength={60}
                      onChange={(e) => editCharacter({ name: e.target.value })}
                    />
                  </Field>
                  <Field label="Tagline">
                    <input
                      value={character.tagline}
                      maxLength={160}
                      onChange={(e) =>
                        editCharacter({ tagline: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Personality">
                    <textarea
                      rows={5}
                      value={character.personality}
                      maxLength={5000}
                      onChange={(e) =>
                        editCharacter({ personality: e.target.value })
                      }
                    />
                  </Field>
                  <Field
                    label="System prompt"
                    hint="Defines how she responds. Relevant memories are added to the prompt automatically."
                  >
                    <textarea
                      rows={7}
                      value={character.systemPrompt}
                      maxLength={10000}
                      onChange={(e) =>
                        editCharacter({ systemPrompt: e.target.value })
                      }
                    />
                  </Field>
                </Section>
              </div>
              <Section
                title="Her appearance"
                subtitle="Character cards reference their own VRM avatar."
              >
                <div className="studio-preview">
                  <Avatar avatar={character.avatar} settings={draft.vrm} />
                </div>
                <button
                  className="button secondary full"
                  disabled={working}
                  onClick={() =>
                    void perform(async () => {
                      const avatar = await bridge.importAvatar();
                      if (avatar) editCharacter({ avatar });
                    })
                  }
                >
                  <ArrowUpFromLine size={16} />
                  Load VRM avatar
                </button>
                <button
                  className="text-button"
                  onClick={() => editCharacter({ avatar: "builtin:eva" })}
                >
                  Use bundled Eva
                </button>
              </Section>
            </div>
          )}

          {tab === "providers" && (
            <>
              <div className="info-banner">
                <ShieldCheck size={18} />
                <div>
                  Credentials stay in the desktop process.
                  <small>
                    {snapshot.secretStorage === "encrypted"
                      ? "API keys are encrypted using your operating system’s secure storage."
                      : "Secure OS storage is unavailable. API keys will be kept only until the app exits."}{" "}
                    Audio and conversation context are sent to the providers you
                    configure.
                  </small>
                </div>
              </div>
              {(["llm", "asr", "tts"] as const).map((kind) => {
                const provider = draft.providers[kind];
                return (
                  <Section
                    key={kind}
                    title={
                      kind === "llm"
                        ? "Think · Language model"
                        : kind === "asr"
                          ? "Listen · Speech recognition"
                          : "Speak · Voice synthesis"
                    }
                    subtitle={
                      kind === "llm"
                        ? "OpenRouter by default. Any Chat Completions compatible endpoint is supported."
                        : "Use a separate OpenAI-compatible audio service, local or hosted."
                    }
                  >
                    <Toggle
                      label="Enable provider"
                      checked={provider.enabled}
                      onChange={(v) =>
                        update((d) => {
                          d.providers[kind].enabled = v;
                        })
                      }
                    />
                    <div className="form-grid">
                      <Field
                        label="API base URL"
                        hint={
                          kind === "llm"
                            ? "Appends /chat/completions"
                            : kind === "asr"
                              ? "Appends /audio/transcriptions"
                              : "Appends /audio/speech"
                        }
                      >
                        <input
                          value={provider.baseUrl}
                          onChange={(e) =>
                            update((d) => {
                              d.providers[kind].baseUrl = e.target.value;
                            })
                          }
                          placeholder="https://provider.example/v1"
                        />
                      </Field>
                      <Field label="Model ID">
                        <input
                          value={provider.model}
                          onChange={(e) =>
                            update((d) => {
                              d.providers[kind].model = e.target.value;
                            })
                          }
                        />
                      </Field>
                      <Field
                        label="API key"
                        hint={
                          provider.hasKey
                            ? "A key is saved. Leave untouched to keep it; use Clear to remove it."
                            : "Optional for local services without authentication."
                        }
                      >
                        <div className="input-action">
                          <input
                            type="password"
                            autoComplete="off"
                            value={keys[kind] ?? ""}
                            placeholder={
                              provider.hasKey
                                ? "•••••••• (stored)"
                                : "Enter API key"
                            }
                            onChange={(e) => {
                              setKeys((k) => ({
                                ...k,
                                [kind]: e.target.value,
                              }));
                              setDirty(true);
                            }}
                          />
                          <button
                            onClick={() => {
                              setKeys((k) => ({ ...k, [kind]: "" }));
                              setDirty(true);
                            }}
                          >
                            Clear
                          </button>
                        </div>
                      </Field>
                      {kind === "tts" && (
                        <Field
                          label="Voice ID"
                          hint="Use a voice supported by your speech server."
                        >
                          <input
                            value={provider.voice}
                            onChange={(e) =>
                              update((d) => {
                                d.providers.tts.voice = e.target.value;
                              })
                            }
                          />
                        </Field>
                      )}
                    </div>
                    <div className="provider-actions">
                      <span>
                        Test sends a small request and may incur provider
                        charges.
                      </span>
                      <button
                        className="button secondary"
                        disabled={working || dirty || !provider.enabled}
                        title={
                          dirty
                            ? "Save your changes first"
                            : "Test saved configuration"
                        }
                        onClick={() =>
                          void perform(async () => {
                            setNotice(await bridge.testProvider(kind));
                          })
                        }
                      >
                        <Activity size={15} />
                        Test connection
                      </button>
                    </div>
                  </Section>
                );
              })}
            </>
          )}

          {tab === "voice" && (
            <div className="two-column">
              <Section title="Conversation audio">
                <Toggle
                  label="Speak replies automatically"
                  hint="Requires an enabled TTS provider."
                  checked={draft.voice.autoSpeak}
                  onChange={(v) =>
                    update((d) => {
                      d.voice.autoSpeak = v;
                    })
                  }
                />
                <Range
                  label="Voice speed"
                  value={draft.voice.speed}
                  min={0.5}
                  max={2}
                  onChange={(v) =>
                    update((d) => {
                      d.voice.speed = v;
                    })
                  }
                />
                <Range
                  label="Playback volume"
                  value={draft.voice.volume}
                  min={0}
                  max={1}
                  onChange={(v) =>
                    update((d) => {
                      d.voice.volume = v;
                    })
                  }
                />
                <Field
                  label="Recognition language"
                  hint="Optional ISO language code, such as en, ru, or ja. Leave empty for auto detection."
                >
                  <input
                    value={draft.voice.language}
                    maxLength={20}
                    placeholder="Auto detect"
                    onChange={(e) =>
                      update((d) => {
                        d.voice.language = e.target.value;
                      })
                    }
                  />
                </Field>
              </Section>
              <Section title="A voice, on your terms">
                <div className="feature-illustration">
                  <AudioLines size={52} />
                </div>
                <h3>Click. Speak. Connect.</h3>
                <p className="muted">
                  Click the microphone in the companion window to begin
                  recording. Click again to finish and send. Recordings stop
                  automatically after 60 seconds.
                </p>
                <p className="muted">
                  The stop button interrupts a reply or speech playback.
                  Microphone capture ends after each recording. The app uses
                  your system’s default input and output devices.
                </p>
                <div className="card-footnote">
                  Always-on listening and voice activity detection are future
                  improvements.
                </div>
              </Section>
            </div>
          )}

          {tab === "vrm" && (
            <div className="two-column studio-layout">
              <Section
                title="Live stage"
                subtitle="Preview changes before saving them."
              >
                <div className="studio-preview large">
                  <Avatar avatar={character.avatar} settings={draft.vrm} />
                  <span className="avatar-tag">{character.name} · VRM</span>
                </div>
                <button
                  className="button secondary full"
                  disabled={working}
                  onClick={() =>
                    void perform(async () => {
                      const avatar = await bridge.importAvatar();
                      if (avatar) editCharacter({ avatar });
                    })
                  }
                >
                  <ArrowUpFromLine size={16} />
                  Load VRM
                </button>
              </Section>
              <div>
                <Section title="Position & framing">
                  <Range
                    label="Zoom"
                    value={draft.vrm.zoom}
                    min={0.5}
                    max={2}
                    onChange={(v) =>
                      update((d) => {
                        d.vrm.zoom = v;
                      })
                    }
                  />
                  <Range
                    label="Horizontal position"
                    value={draft.vrm.x}
                    min={-1}
                    max={1}
                    onChange={(v) =>
                      update((d) => {
                        d.vrm.x = v;
                      })
                    }
                  />
                  <Range
                    label="Vertical position"
                    value={draft.vrm.y}
                    min={-1}
                    max={1}
                    onChange={(v) =>
                      update((d) => {
                        d.vrm.y = v;
                      })
                    }
                  />
                  <Range
                    label="Rotation"
                    value={draft.vrm.rotation}
                    min={-180}
                    max={180}
                    step={1}
                    onChange={(v) =>
                      update((d) => {
                        d.vrm.rotation = v;
                      })
                    }
                  />
                </Section>
                <Section title="Light & motion">
                  <Range
                    label="Key light intensity"
                    value={draft.vrm.lightIntensity}
                    min={0}
                    max={5}
                    onChange={(v) =>
                      update((d) => {
                        d.vrm.lightIntensity = v;
                      })
                    }
                  />
                  <Field label="Light color">
                    <input
                      className="color-input"
                      type="color"
                      value={draft.vrm.lightColor}
                      onChange={(e) =>
                        update((d) => {
                          d.vrm.lightColor = e.target.value;
                        })
                      }
                    />
                  </Field>
                  <Field label="Animation">
                    <select
                      value={draft.vrm.animation}
                      onChange={(e) =>
                        update((d) => {
                          d.vrm.animation = e.target
                            .value as AppSettings["vrm"]["animation"];
                        })
                      }
                    >
                      {Object.entries({
                        idle_loop: "Relaxed idle",
                        modelPose: "Model pose",
                        greeting: "Greeting",
                        peaceSign: "Peace sign",
                        dance: "Dance",
                        showFullBody: "Full body",
                        shoot: "Finger guns",
                        spin: "Spin",
                        squat: "Squat",
                      }).map(([value, label]) => (
                        <option value={value} key={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Toggle
                    label="Natural blinking"
                    checked={draft.vrm.autoBlink}
                    onChange={(v) =>
                      update((d) => {
                        d.vrm.autoBlink = v;
                      })
                    }
                  />
                  <Toggle
                    label="Keep companion on top"
                    checked={draft.window.alwaysOnTop}
                    onChange={(v) =>
                      update((d) => {
                        d.window.alwaysOnTop = v;
                      })
                    }
                  />
                  <button
                    className="text-button"
                    onClick={() =>
                      update((d) => {
                        d.vrm = structuredClone(defaultSettings.vrm);
                      })
                    }
                  >
                    <RotateCcw size={14} />
                    Reset stage
                  </button>
                </Section>
              </div>
            </div>
          )}

          {tab === "memory" && (
            <>
              <div className="memory-header">
                <div className="info-banner">
                  <Brain size={20} />
                  <div>
                    {persistedCharacter.name}’s memory
                    <small>
                      Facts and past conversations belong to the saved active
                      character. Imports merge into this character without
                      replacing existing memories.
                    </small>
                  </div>
                </div>
                <div className="button-row">
                  <button
                    className="button secondary"
                    disabled={working || snapshot.busy}
                    onClick={() =>
                      void perform(async () => {
                        if (await bridge.importMemory())
                          setNotice("Memories imported.");
                      })
                    }
                  >
                    <ArrowUpFromLine size={15} />
                    Import
                  </button>
                  <button
                    className="button secondary"
                    disabled={working}
                    onClick={() =>
                      void perform(async () => {
                        if (await bridge.exportMemory())
                          setNotice(
                            "Memory archive exported without API keys.",
                          );
                      })
                    }
                  >
                    <ArrowDownToLine size={15} />
                    Export
                  </button>
                </div>
              </div>
              <div className="two-column">
                <div>
                  <Section
                    title="Long-term memories"
                    subtitle="Relevant facts are recalled when she replies."
                  >
                    <input
                      className="memory-search"
                      placeholder="Search memories…"
                      aria-label="Search memories"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    {!facts.length && (
                      <div className="empty-state">
                        <Brain size={34} />
                        <h3>
                          {search
                            ? "No matching memories"
                            : "The beginning of knowing you"}
                        </h3>
                        <p>
                          {search
                            ? "Try a different search."
                            : "Add a preference, an interest, or something you’d like her to remember."}
                        </p>
                      </div>
                    )}
                    {facts.map((f) => (
                      <div className="memory-item" key={f.id}>
                        <p>{f.text}</p>
                        <div>
                          <span>
                            {f.source === "manual"
                              ? "Added by you"
                              : "From conversation"}{" "}
                            · {new Date(f.updatedAt).toLocaleDateString()}
                          </span>
                          <button
                            className="text-button"
                            onClick={() => {
                              setEditing(f);
                              setFactText(f.text);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            className="icon-button danger"
                            title="Delete fact"
                            aria-label={`Delete memory: ${f.text}`}
                            disabled={working}
                            onClick={() =>
                              void perform(
                                () => bridge.deleteFact(f.id),
                                "Memory deleted.",
                              )
                            }
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </Section>
                  <Section title={editing ? "Edit memory" : "Add a memory"}>
                    <Field label="What should she remember?">
                      <textarea
                        rows={3}
                        maxLength={1000}
                        value={factText}
                        onChange={(e) => setFactText(e.target.value)}
                        placeholder="I like rainy evenings and building cozy houses in Minecraft."
                      />
                    </Field>
                    <div className="button-row">
                      <button
                        className="button primary"
                        disabled={working || !factText.trim()}
                        onClick={() =>
                          void perform(async () => {
                            await bridge.saveFact({
                              id: editing?.id,
                              text: factText,
                            });
                            setFactText("");
                            setEditing(undefined);
                          }, "Memory saved.")
                        }
                      >
                        <Plus size={15} />
                        {editing ? "Update memory" : "Add memory"}
                      </button>
                      {editing && (
                        <button
                          className="button secondary"
                          onClick={() => {
                            setEditing(undefined);
                            setFactText("");
                          }}
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </Section>
                </div>
                <div>
                  <Section title="How remembering works">
                    <Range
                      label="Recent messages in context"
                      value={draft.memory.contextMessages}
                      min={4}
                      max={80}
                      step={2}
                      onChange={(v) =>
                        update((d) => {
                          d.memory.contextMessages = v;
                        })
                      }
                    />
                    <Range
                      label="Facts and past messages to recall (each)"
                      value={draft.memory.recallCount}
                      min={0}
                      max={20}
                      step={1}
                      onChange={(v) =>
                        update((d) => {
                          d.memory.recallCount = v;
                        })
                      }
                    />
                    <Toggle
                      label="Automatically remember facts"
                      hint="An additional LLM request extracts explicit preferences and facts after each reply. Review and edit them here."
                      checked={draft.memory.autoRemember}
                      onChange={(v) =>
                        update((d) => {
                          d.memory.autoRemember = v;
                        })
                      }
                    />
                    <p className="muted">
                      Recent messages form short-term context. Older
                      conversations remain on disk and can be recalled by
                      keyword relevance. Facts persist across sessions and app
                      restarts.
                    </p>
                  </Section>
                  <Section title="Conversation history">
                    <p className="muted">
                      Start fresh while keeping past conversations available for
                      recall, or delete this character’s entire chat history.
                    </p>
                    <button
                      className="button secondary full"
                      disabled={working || snapshot.busy}
                      onClick={() =>
                        void perform(
                          () => bridge.newSession(),
                          "New conversation started. Memories are kept.",
                        )
                      }
                    >
                      <Plus size={15} />
                      New conversation
                    </button>
                    <button
                      className="text-button danger"
                      disabled={working || snapshot.busy}
                      onClick={() => void perform(() => bridge.clearHistory())}
                    >
                      <Trash2 size={14} />
                      Delete conversation history…
                    </button>
                  </Section>
                </div>
              </div>
            </>
          )}

          {tab === "consciousness" && (
            <Section
              title="A spark of her own"
              subtitle="Planned for sprint 02. These capabilities are not running yet."
            >
              <div className="future-hero">
                <Sparkles size={48} />
                <h2>More than a reply.</h2>
                <p>
                  A future behavioral state system will give her changing moods,
                  curiosity, and a rhythm of her own. This simulates autonomous
                  behavior; it is not a claim of sentience.
                </p>
              </div>
              <div className="roadmap-grid">
                {[
                  [
                    "Emotional state",
                    "Mood, boredom, and a relationship state that evolve from interactions.",
                  ],
                  [
                    "A sense of time",
                    "An internal timer with quiet hours, cooldowns, and a limit on proactive messages.",
                  ],
                  [
                    "Intent & follow-through",
                    "Durable scheduled tasks, wake-ups, cancellation, and a visible activity log.",
                  ],
                ].map(([title, text]) => (
                  <div className="roadmap-card" key={title}>
                    <h3>{title}</h3>
                    <p>{text}</p>
                    <span className="coming">Sprint 02</span>
                  </div>
                ))}
              </div>
            </Section>
          )}
          {tab === "plugins" && (
            <>
              <Section
                title="Room to grow"
                subtitle="Contracts are defined. Plugin execution and MCP connections arrive in later sprints."
              >
                <div className="future-hero">
                  <Puzzle size={48} />
                  <h2>Her world, extended.</h2>
                  <p>
                    New channels and abilities will connect to the same
                    conversation and memory runtime, with explicit permissions
                    for each capability.
                  </p>
                </div>
                <div className="roadmap-grid">
                  {[
                    [
                      "Telegram",
                      "Stay connected away from your desktop. Account pairing and the same character memory.",
                      "Sprint 03",
                    ],
                    [
                      "MCP connections",
                      "A tool registry, server configuration, permission prompts, timeouts, and audit history.",
                      "Sprint 04",
                    ],
                    [
                      "Minecraft",
                      "Observe the world, plan actions, and play together through a dedicated game adapter.",
                      "Sprint 04",
                    ],
                  ].map(([title, text, sprint]) => (
                    <div className="roadmap-card" key={title}>
                      <h3>{title}</h3>
                      <p>{text}</p>
                      <span className="coming">{sprint}</span>
                    </div>
                  ))}
                </div>
              </Section>
            </>
          )}
          <footer className="page-footer">
            <span>Built for a connection that feels a little more human.</span>
            <span>EVANGELION / FOUNDATION</span>
          </footer>
        </main>
        <div className="savebar">
          <span>
            {dirty ? (
              "You have unsaved changes"
            ) : (
              <>
                <Check size={14} />
                All changes saved
              </>
            )}
          </span>
          <div className="button-row">
            <button
              className="button secondary"
              disabled={!dirty || working}
              onClick={() => {
                setDraft(structuredClone(snapshot.settings));
                setKeys({});
                setDirty(false);
              }}
            >
              Discard
            </button>
            <button
              className="button primary"
              disabled={!dirty || working || snapshot.busy}
              onClick={() => void save()}
            >
              <Save size={15} />
              {working ? "Working…" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
