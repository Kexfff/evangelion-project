import { useEffect, useId, useState, type ReactNode } from "react";
import { OpenRouterProviders } from "./OpenRouterProviders";
import { isOpenRouter } from "../shared/openrouter";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  AudioLines,
  BookHeart,
  Brain,
  Check,
  ChevronRight,
  CircleHelp,
  Cpu,
  Heart,
  House,
  MessageCircleHeart,
  Plus,
  Puzzle,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  Shirt,
  ShieldCheck,
  Sparkles,
  UserRound,
  Volume2,
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

// Sidebar order, labels and the heading each page shows.
const navigation = [
  {
    id: "overview",
    label: "Home",
    icon: House,
    title: "Welcome home",
    description: "Everything about your companion, in one cozy place.",
  },
  {
    id: "character",
    label: "Personality",
    icon: UserRound,
    title: "Who she is",
    description: "Her name, her personality and the way she talks to you.",
  },
  {
    id: "providers",
    label: "AI services",
    icon: Cpu,
    title: "How she thinks, hears and speaks",
    description:
      "Connect the AI services behind her mind and voice. Keys stay on this computer.",
  },
  {
    id: "voice",
    label: "Her voice",
    icon: AudioLines,
    title: "Her voice",
    description: "Microphone, speech and the rhythm of your conversations.",
  },
  {
    id: "vrm",
    label: "Appearance",
    icon: Shirt,
    title: "How she looks",
    description: "Her avatar, framing, lighting and little movements.",
  },
  {
    id: "memory",
    label: "Memories",
    icon: BookHeart,
    title: "What she remembers",
    description: "The facts and conversations she carries with her.",
  },
  {
    id: "consciousness",
    label: "Inner life",
    icon: Sparkles,
    title: "Her inner life",
    description:
      "Simulated moods, initiative and reminders — always under your control.",
  },
  {
    id: "plugins",
    label: "Integrations",
    icon: Puzzle,
    title: "Integrations",
    description: "Play Minecraft together, chat on Telegram and connect tools.",
  },
] as const;
type Tab = (typeof navigation)[number]["id"];
const providerInfo: Record<
  ProviderKind,
  { title: string; subtitle: string; endpoint: string; icon: typeof Brain }
> = {
  llm: {
    title: "Think",
    subtitle:
      "Her language model. OpenRouter by default; any Chat Completions–compatible service works.",
    endpoint: "…/chat/completions",
    icon: Brain,
  },
  asr: {
    title: "Listen",
    subtitle:
      "Speech recognition: turns your voice into text. Any OpenAI-compatible audio service, local or hosted.",
    endpoint: "…/audio/transcriptions",
    icon: AudioLines,
  },
  tts: {
    title: "Speak",
    subtitle:
      "Voice synthesis: gives her a voice. Any OpenAI-compatible speech service, local or hosted.",
    endpoint: "…/audio/speech",
    icon: Volume2,
  },
  embedding: {
    title: "Remember",
    subtitle:
      "Embeddings for recalling memories by meaning. Needs its own API key, even on OpenRouter.",
    endpoint: "…/embeddings",
    icon: BookHeart,
  },
};
// Plain http is fine for this computer or a local network service, but keys
// and conversations sent to a remote host that way travel unencrypted.
function isUnencryptedRemote(baseUrl: string) {
  try {
    const url = new URL(baseUrl);
    return (
      url.protocol === "http:" &&
      !/^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[^.]+\.local)$/.test(
        url.hostname,
      )
    );
  } catch {
    return false;
  }
}
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
  const hintId = useId();
  return (
    <label className="toggle-row">
      <div>
        <span>{label}</span>
        {hint && <small id={hintId}>{hint}</small>}
      </div>
      <input
        className="toggle"
        type="checkbox"
        aria-label={label}
        aria-describedby={hint ? hintId : undefined}
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
  actions,
  icon,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      <div className={`section-heading ${actions ? "with-actions" : ""}`}>
        {icon}
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions && <div className="button-row">{actions}</div>}
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
  const launch = () => perform(() => bridge.windowAction("companion"));
  const page = navigation.find((n) => n.id === tab)!;
  return (
    <div className="settings-shell">
      <aside className="sidebar">
        <div className="sidebar-companion">
          <span className="mini-avatar" aria-hidden>
            {persistedCharacter.name.slice(0, 1)}
          </span>
          <div>
            <strong>{persistedCharacter.name}</strong>
            <small>
              <i className="status-dot" />
              Ready to chat
            </small>
          </div>
        </div>
        <button className="button primary full" onClick={launch}>
          <MessageCircleHeart size={16} />
          Talk to {persistedCharacter.name}
        </button>
        <nav aria-label="Settings sections">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              aria-label={label}
              title={label}
              aria-current={tab === id ? "page" : undefined}
              onClick={() => setTab(id)}
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-badge">
            <ShieldCheck size={15} />
            Memories and keys stay on this computer.
          </div>
          <div className="version">
            Evangelion <span>v0.4.24</span>
          </div>
        </div>
      </aside>
      <div className="settings-body">
        <main className="settings-content">
          <header className="page-heading">
            <h1>{page.title}</h1>
            <p>{page.description}</p>
          </header>
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
                <section
                  className="hero-card"
                  aria-label={`Meet ${character.name}`}
                >
                  <div className="hero-text">
                    <h2>Meet {persistedCharacter.name}</h2>
                    {persistedCharacter.tagline && (
                      <p>{persistedCharacter.tagline}</p>
                    )}
                    <button
                      className="hero-memories"
                      onClick={() => setTab("memory")}
                    >
                      <Heart size={15} />
                      {snapshot.facts.length === 0
                        ? "No memories yet"
                        : snapshot.facts.length === 1
                          ? "1 memory"
                          : `${snapshot.facts.length.toLocaleString()} memories`}
                      <ChevronRight size={14} />
                    </button>
                    <div className="button-row">
                      <button className="button primary" onClick={launch}>
                        <MessageCircleHeart size={16} />
                        Talk to {persistedCharacter.name}
                      </button>
                      <button
                        className="button secondary"
                        onClick={() => setTab("character")}
                      >
                        Edit personality
                      </button>
                    </div>
                  </div>
                  {/* A static portrait: a live VRM here cost too much on the
                      most-visited page. Appearance keeps the 3D preview. */}
                  <div className="hero-portrait" aria-hidden="true">
                    <span className="hero-portrait-ring" />
                    <span className="hero-portrait-initial">
                      {persistedCharacter.name.slice(0, 1)}
                    </span>
                    <Sparkles className="hero-spark one" size={22} />
                    <Heart className="hero-spark two" size={18} />
                    <Sparkles className="hero-spark three" size={14} />
                  </div>
                </section>
                <section className="connection-card card">
                  <div className="section-heading">
                    <h2>Getting her ready</h2>
                    <p>
                      She needs three AI services to listen, think and speak.
                    </p>
                  </div>
                  {(
                    [
                      {
                        kind: "asr",
                        title: "Listen",
                        detail: "Turns your voice into text",
                        icon: AudioLines,
                      },
                      {
                        kind: "llm",
                        title: "Think",
                        detail: "Her language model",
                        icon: Brain,
                      },
                      {
                        kind: "tts",
                        title: "Speak",
                        detail: "Gives her a voice",
                        icon: Volume2,
                      },
                    ] as const
                  ).map(({ kind, title, detail, icon: Icon }) => {
                    const ready = snapshot.settings.providers[kind].enabled;
                    return (
                      <button
                        className="connection-step"
                        key={kind}
                        onClick={() => setTab("providers")}
                      >
                        <span className={`step-icon ${kind}`}>
                          <Icon size={18} />
                        </span>
                        <span>
                          <strong>{title}</strong>
                          <small>{detail}</small>
                        </span>
                        <span
                          className={`connection-status ${ready ? "configured" : ""}`}
                        >
                          {ready ? (
                            <>
                              <Check size={13} />
                              Ready
                            </>
                          ) : (
                            "Set up"
                          )}
                          <ChevronRight size={13} />
                        </span>
                      </button>
                    );
                  })}
                </section>
              </div>
              <OverviewStatistics
                name={persistedCharacter.name}
                stats={snapshot.historyStats}
              />
            </>
          )}

          {tab === "character" && (
            <>
              <Section
                title="Your characters"
                subtitle="Each character has their own conversations and memories."
                actions={
                  <>
                    <button
                      className="button secondary"
                      disabled={working || dirty}
                      title={
                        dirty
                          ? "Save your edits before importing a card."
                          : undefined
                      }
                      onClick={() =>
                        void perform(async () => {
                          if (await bridge.importCharacter()) {
                            const refreshed = await bridge.snapshot();
                            setSnapshot(refreshed);
                            // Imports create an inactive card. Refresh the editable copy too,
                            // otherwise the next Save could remove that new card again.
                            setDraft(refreshed.settings);
                          }
                        })
                      }
                    >
                      <ArrowDownToLine size={15} />
                      Import character card
                    </button>
                    <button
                      className="button secondary"
                      disabled={working}
                      onClick={() =>
                        void perform(async () => {
                          await bridge.exportCharacter();
                        })
                      }
                    >
                      <ArrowUpFromLine size={15} />
                      Export saved card
                    </button>
                  </>
                }
              >
                <div className="character-list">
                  {draft.characters.map((c) => (
                    <button
                      className={
                        c.id === character.id
                          ? "character-option selected"
                          : "character-option"
                      }
                      aria-pressed={c.id === character.id}
                      key={c.id}
                      onClick={() =>
                        update((d) => {
                          d.activeCharacterId = c.id;
                        })
                      }
                    >
                      <span className="mini-avatar">{c.name.slice(0, 1)}</span>
                      <span>
                        {c.name}
                        <small>{c.tagline}</small>
                      </span>
                      {c.id === character.id && <Check size={16} />}
                    </button>
                  ))}
                  <button
                    className="character-option add"
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
                    <Plus size={18} />
                    New character
                  </button>
                </div>
                <p className="hint">
                  Cards carry a character’s personality, prompts and custom
                  avatar — never memories or keys. Save your edits before
                  importing or exporting; imported cards wait until you pick
                  them.
                </p>
              </Section>
              <Section
                title={`Who ${character.name || "she"} is`}
                subtitle="Changes apply to new replies after you save."
              >
                <div className="form-grid">
                  <Field label="Name">
                    <input
                      value={character.name}
                      maxLength={60}
                      onChange={(e) => editCharacter({ name: e.target.value })}
                    />
                  </Field>
                  <Field label="Tagline" hint="A short line shown on Home.">
                    <input
                      value={character.tagline}
                      maxLength={160}
                      onChange={(e) =>
                        editCharacter({ tagline: e.target.value })
                      }
                    />
                  </Field>
                </div>
                <Field
                  label="Personality"
                  hint="Her temperament, interests and quirks, in a few sentences."
                >
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
                  hint="Her core instructions for every reply. Relevant memories are added automatically."
                >
                  <textarea
                    rows={8}
                    value={character.systemPrompt}
                    maxLength={10000}
                    onChange={(e) =>
                      editCharacter({ systemPrompt: e.target.value })
                    }
                  />
                </Field>
              </Section>
            </>
          )}

          {tab === "providers" && (
            <>
              <div className="info-banner">
                <ShieldCheck size={18} />
                <div>
                  Your API keys stay on this computer.
                  <small>
                    {snapshot.secretStorage === "encrypted"
                      ? "They’re encrypted with your operating system’s secure storage."
                      : "They’re kept in a local encrypted file whose key sits beside it with owner-only permissions — not your OS keyring."}{" "}
                    Your voice and conversations are sent to the services you
                    set up here.
                  </small>
                </div>
              </div>
              {providerKinds.map((kind) => {
                const provider = draft.providers[kind];
                const info = providerInfo[kind];
                const Icon = info.icon;
                return (
                  <Section
                    key={kind}
                    className="provider-card"
                    title={info.title}
                    subtitle={info.subtitle}
                    actions={
                      <label className="provider-switch">
                        {provider.enabled ? "On" : "Off"}
                        <input
                          className="toggle"
                          type="checkbox"
                          aria-label={`Use the ${info.title} service`}
                          checked={provider.enabled}
                          onChange={(e) =>
                            update((d) => {
                              d.providers[kind].enabled = e.target.checked;
                            })
                          }
                        />
                      </label>
                    }
                    icon={
                      <span className={`step-icon ${kind}`}>
                        <Icon size={18} />
                      </span>
                    }
                  >
                    <div className="form-grid">
                      <Field
                        label="API base URL"
                        hint={
                          isUnencryptedRemote(provider.baseUrl)
                            ? undefined
                            : `Requests go to ${info.endpoint}`
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
                        {isUnencryptedRemote(provider.baseUrl) && (
                          <small className="field-warning">
                            This address isn’t encrypted. Your API key and
                            conversations would travel in plain text — use https
                            unless it’s on your own network.
                          </small>
                        )}
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
                            ? "A key is saved. Leave this empty to keep it, or Clear to remove it."
                            : "Optional for local services without a key."
                        }
                      >
                        <div className="input-action">
                          <input
                            type="password"
                            autoComplete="off"
                            value={keys[kind] ?? ""}
                            placeholder={
                              provider.hasKey
                                ? "•••••••• (saved)"
                                : "Paste your API key"
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
                          hint="A voice your speech service supports."
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
                      {kind === "tts" && (
                        <Field
                          label="Audio format"
                          hint={
                            provider.responseFormat === "pcm"
                              ? "PCM is 16-bit little-endian and plays once each sentence has arrived. Sample rate and channels come from the response (default 24 kHz mono)."
                              : "MP3 starts playing while it streams. Choose PCM if your model requires it."
                          }
                        >
                          <select
                            value={provider.responseFormat}
                            onChange={(e) =>
                              update((d) => {
                                d.providers.tts.responseFormat = e.target
                                  .value as "mp3" | "pcm";
                              })
                            }
                          >
                            <option value="mp3">MP3</option>
                            <option value="pcm">PCM</option>
                          </select>
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
                            ? "Save your changes first"
                            : "Fetch model IDs from this service"
                        }
                        onClick={() =>
                          void perform(async () => {
                            const ids = await bridge.listModels(kind);
                            setModels((old) => ({ ...old, [kind]: ids }));
                            setNotice(
                              `${ids.length} model IDs fetched. Pick one from the Model ID suggestions or type your own.`,
                            );
                          })
                        }
                      >
                        <RefreshCw size={15} />
                        Fetch models
                      </button>
                      <button
                        className="button secondary"
                        disabled={working || dirty || !provider.enabled}
                        title={
                          dirty
                            ? "Save your changes first"
                            : "Test the saved settings"
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
                      <span>
                        {dirty
                          ? "Save your changes to fetch models or test."
                          : "A test sends one small request, which your service may charge for."}
                      </span>
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
                title="Live preview"
                subtitle="Changes show here right away; save to keep them."
              >
                <div className="studio-preview large">
                  <Avatar avatar={character.avatar} settings={draft.vrm} />
                </div>
                <div className="button-row studio-actions">
                  <button
                    className="button secondary"
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
                  {character.avatar !== "builtin:eva" && (
                    <button
                      className="text-button"
                      onClick={() => editCharacter({ avatar: "builtin:eva" })}
                    >
                      Use bundled avatar
                    </button>
                  )}
                </div>
                <details className="avatar-credits">
                  <summary>
                    Avatar credits
                    <ChevronRight size={15} />
                  </summary>
                  <p className="hint">
                    Optional details about where this model came from. They
                    travel with exported character cards.
                  </p>
                  <div className="form-grid">
                    {(["author", "source", "license", "notes"] as const).map(
                      (key) => (
                        <Field key={key} label={`Avatar ${key}`}>
                          <input
                            value={character.avatarMetadata?.[key] ?? ""}
                            maxLength={
                              key === "author"
                                ? 300
                                : key === "source"
                                  ? 1000
                                  : 2000
                            }
                            onChange={(e) =>
                              editCharacter({
                                avatarMetadata: {
                                  ...{
                                    author: "",
                                    source: "",
                                    license: "",
                                    notes: "",
                                  },
                                  ...character.avatarMetadata,
                                  [key]: e.target.value,
                                },
                              })
                            }
                          />
                        </Field>
                      ),
                    )}
                  </div>
                </details>
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
                  <Field label="Gaze">
                    <select
                      value={draft.vrm.gaze}
                      onChange={(e) =>
                        update((d) => {
                          d.vrm.gaze = e.target
                            .value as AppSettings["vrm"]["gaze"];
                        })
                      }
                    >
                      <option value="natural">Natural glances</option>
                      <option value="pointer">Follow pointer</option>
                      <option value="forward">Look forward</option>
                    </select>
                  </Field>
                  <Field
                    label="Mouth animation"
                    hint="Text-guided shapes are approximate, not provider-timed phonemes. Audio amplitude controls opening; silence closes the mouth."
                  >
                    <select
                      value={draft.vrm.lipSync}
                      onChange={(e) =>
                        update((d) => {
                          d.vrm.lipSync = e.target.value as
                            "text" | "amplitude";
                        })
                      }
                    >
                      <option value="text">Text-guided vowel shapes</option>
                      <option value="amplitude">Simple audio amplitude</option>
                    </select>
                  </Field>
                  <Range
                    label="Expression strength"
                    value={draft.vrm.expressionStrength}
                    min={0}
                    max={1}
                    onChange={(v) =>
                      update((d) => {
                        d.vrm.expressionStrength = v;
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
                subtitle="These apply once you save your changes."
              >
                <Toggle
                  label="Automatically remember facts"
                  hint="She notes clear facts you mention while you chat. Uses one extra request to your language model per reply (two if the first answer is unusable)."
                  checked={draft.memory.autoRemember}
                  onChange={(v) =>
                    update((d) => {
                      d.memory.autoRemember = v;
                    })
                  }
                />
                <Toggle
                  label="Semantic memory"
                  hint="Recall related ideas even when the words differ. Needs the Remember service; memories and questions are sent to it."
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
                    Set up the Remember service <ChevronRight size={13} />
                  </button>
                )}
                <details className="memory-advanced">
                  <summary>
                    <Settings2 size={14} /> Fine-tune recall
                  </summary>
                  <p className="memory-helper">
                    Recent messages are always in context. Older conversations
                    are recalled by meaning, or by keywords when the Remember
                    service is off.
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
                        ? "Turn on the Remember service in AI services first."
                        : "Sends saved facts and past messages to the Remember service, which may charge for it."}
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
        </main>
        <div className="savebar" hidden={!dirty}>
          <span>You have unsaved changes</span>
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
