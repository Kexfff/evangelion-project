import { useEffect, useState, type ReactNode } from "react";
import { OpenRouterProviders } from "./OpenRouterProviders";
import { isOpenRouter } from "../shared/openrouter";
import {
  Activity,
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
  UserRound,
  Volume2,
  WandSparkles,
  X,
} from "lucide-react";
import { bridge } from "../bridge";
import { ConsciousnessSettings } from "./ConsciousnessSettings";
import { MemorySettings } from "./MemorySettings";
import { OverviewStatistics } from "./OverviewStatistics";
import { IntegrationSettings } from "./IntegrationSettings";
import {
  defaultSettings,
  settingsSchema,
  providerKinds,
  type Character,
  type ProviderKind,
  type Settings as AppSettings,
  type Snapshot,
} from "../shared/schema";
import { Avatar } from "./Avatar";
import { VoiceSettings } from "./VoiceSettings";

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
  consciousness: "A rhythm of her own, with you in control.",
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
  const [models, setModels] = useState<Partial<Record<ProviderKind, string[]>>>(
    {},
  );
  const [tab, setTab] = useState<Tab>("overview");
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [draft, setDraft] = useState<AppSettings>();
  const [dirty, setDirty] = useState(false);
  const [keys, setKeys] = useState<Partial<Record<ProviderKind, string>>>({});
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  useEffect(() => {
    if (snapshot)
      setDraft((old) =>
        old
          ? {
              ...old,
              autonomy: {
                ...old.autonomy,
                paused: snapshot.settings.autonomy.paused,
              },
            }
          : old,
      );
  }, [snapshot?.settings.autonomy.paused]);
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
  const counts = ["llm", "asr", "tts"]
    .map((k) => snapshot.settings.providers[k as ProviderKind])
    .filter((p) => p.enabled).length;
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
            evangelion_project <span>v0.4.11</span>
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
            Sprint 4 · Minecraft
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
          {!!snapshot.mcp?.pending.length && tab !== "plugins" && (
            <div className="success-notice" role="status">
              An external tool needs your approval.{" "}
              <button
                className="button secondary"
                onClick={() => setTab("plugins")}
              >
                Review tool request
              </button>
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
              <OverviewStatistics
                name={persistedCharacter.name}
                stats={snapshot.historyStats}
              />
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
                  Use bundled avatar
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
                      : "Keys persist in a local encrypted file. Its key is stored beside it with owner-only permissions; this is not OS-keyring protection."}{" "}
                    Audio and conversation context are sent to the providers you
                    configure.
                  </small>
                </div>
              </div>
              {providerKinds.map((kind) => {
                const provider = draft.providers[kind];
                return (
                  <Section
                    key={kind}
                    title={
                      kind === "llm"
                        ? "Think · Language model"
                        : kind === "asr"
                          ? "Listen · Speech recognition"
                          : kind === "tts"
                            ? "Speak · Voice synthesis"
                            : "Remember · Embeddings"
                    }
                    subtitle={
                      kind === "llm"
                        ? "OpenRouter by default. Any Chat Completions compatible endpoint is supported."
                        : kind === "embedding"
                          ? "OpenAI-compatible embeddings for meaning-based memory. Configure its own API key, even if using OpenRouter for both."
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
                              : kind === "tts"
                                ? "Appends /audio/speech"
                                : "Appends /embeddings"
                        }
                      >
                        <input
                          value={provider.baseUrl}
                          onChange={(e) =>
                            update((d) => {
                              d.providers[kind].baseUrl = e.target.value;
                              if (
                                d.providers[kind].openrouterProviders?.[
                                  provider.model
                                ]?.length === 0
                              )
                                delete d.providers[kind].openrouterProviders![
                                  provider.model
                                ];
                            })
                          }
                          placeholder="https://provider.example/v1"
                        />
                      </Field>
                      <Field label="Model ID">
                        <input
                          list={`models-${kind}`}
                          value={provider.model}
                          onChange={(e) =>
                            update((d) => {
                              d.providers[kind].model = e.target.value;
                              if (
                                d.providers[kind].openrouterProviders?.[
                                  provider.model
                                ]?.length === 0
                              )
                                delete d.providers[kind].openrouterProviders![
                                  provider.model
                                ];
                            })
                          }
                        />
                        <datalist id={`models-${kind}`}>
                          {models[kind]?.map((id) => (
                            <option key={id} value={id} />
                          ))}
                        </datalist>
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
                    {kind === "llm" && isOpenRouter(provider.baseUrl) && (
                      <OpenRouterProviders
                        key={`${provider.baseUrl}/${provider.model}`}
                        model={provider.model}
                        selected={
                          provider.openrouterProviders?.[provider.model]
                        }
                        onChange={(ids) =>
                          update((d) => {
                            const choices =
                              (d.providers.llm.openrouterProviders ??= {});
                            if (ids === undefined)
                              delete choices[provider.model];
                            else choices[provider.model] = ids;
                          })
                        }
                      />
                    )}
                    <div className="provider-actions">
                      <button
                        className="button secondary"
                        disabled={working || dirty}
                        title={
                          dirty
                            ? "Save your provider configuration first"
                            : "Fetch model IDs from this provider"
                        }
                        onClick={() =>
                          void perform(async () => {
                            const ids = await bridge.listModels(kind);
                            setModels((old) => ({ ...old, [kind]: ids }));
                            setNotice(
                              `${ids.length} model IDs fetched. Choose from Model ID suggestions or enter one manually.`,
                            );
                          })
                        }
                      >
                        Fetch models
                      </button>
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
            <VoiceSettings
              voice={draft.voice}
              change={(patch) =>
                update((d) => {
                  Object.assign(d.voice, patch);
                })
              }
            />
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
            <MemorySettings
              key={snapshot.settings.activeCharacterId}
              snapshot={snapshot}
              working={working}
              perform={perform}
              notice={setNotice}
            >
              <Section
                title="How remembering works"
                subtitle="These preferences use Save changes below."
              >
                <Toggle
                  label="Automatically remember facts"
                  hint="Save explicit details from conversations using an extra LLM request. Invalid output retries once (additional usage)."
                  checked={draft.memory.autoRemember}
                  onChange={(v) =>
                    update((d) => {
                      d.memory.autoRemember = v;
                    })
                  }
                />
                <Toggle
                  label="Semantic memory"
                  hint="Recall related ideas even when the words differ. Enable an embedding provider first; memories and queries are sent to it."
                  checked={draft.memory.semanticEnabled}
                  onChange={(v) =>
                    update((d) => {
                      d.memory.semanticEnabled = v;
                    })
                  }
                />
                {!draft.providers.embedding.enabled && (
                  <button
                    className="text-button"
                    onClick={() => setTab("providers")}
                  >
                    Set up an embedding provider <ChevronRight size={13} />
                  </button>
                )}
                <details className="memory-advanced">
                  <summary>
                    <Settings2 size={14} /> Fine-tune recall
                  </summary>
                  <p className="memory-helper">
                    Recent messages stay in context. Older conversations can be
                    recalled by meaning, with keyword fallback if embeddings are
                    unavailable.
                  </p>
                  <Range
                    label="Minimum semantic similarity"
                    value={draft.memory.semanticThreshold}
                    min={0}
                    max={1}
                    step={0.05}
                    onChange={(v) =>
                      update((d) => {
                        d.memory.semanticThreshold = v;
                      })
                    }
                  />
                  <button
                    className="button secondary full"
                    disabled={
                      working ||
                      dirty ||
                      snapshot.busy ||
                      !draft.providers.embedding.enabled
                    }
                    onClick={() =>
                      void perform(async () => {
                        const result = await bridge.reindexMemory();
                        setNotice(
                          `Semantic index ready: ${result.indexed} of ${result.total} memories and past messages.`,
                        );
                      })
                    }
                  >
                    Build / update semantic index
                  </button>
                  <p className="memory-helper">
                    {dirty
                      ? "Save your changes before updating the index."
                      : !draft.providers.embedding.enabled
                        ? "Enable an embedding provider in Providers first."
                        : "Sends saved facts and past message text to your embedding provider. Provider charges may apply."}
                  </p>
                  {working && (
                    <button
                      className="text-button"
                      onClick={() => void bridge.cancel()}
                    >
                      Cancel current operation
                    </button>
                  )}
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
                </details>
              </Section>
            </MemorySettings>
          )}

          {tab === "consciousness" && (
            <ConsciousnessSettings
              key={snapshot.settings.activeCharacterId}
              config={draft.autonomy}
              data={snapshot.autonomy}
              change={(patch) =>
                update((d) => {
                  Object.assign(d.autonomy, patch);
                })
              }
              report={(error) =>
                setError(error instanceof Error ? error.message : String(error))
              }
            />
          )}
          {tab === "plugins" && (
            <>
              <IntegrationSettings snapshot={snapshot} />
            </>
          )}
          <footer className="page-footer">
            <span>Built for a connection that feels a little more human.</span>
            <span>EVANGELION / FOUNDATION</span>
          </footer>
        </main>
        <div className="savebar" hidden={tab === "plugins" && !dirty}>
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
