import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BookOpen,
  Brain,
  Check,
  MessageCircle,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { bridge } from "../bridge";
import type { Fact, Snapshot } from "../shared/schema";
import { MemoryConstellation } from "./MemoryConstellation";
import { ConversationHistory } from "./ConversationHistory";
import { MemoryLab } from "./MemoryLab";
import type { MemoryMap } from "../shared/memory-tools";

type Filter = "all" | Fact["source"];
const sourceLabel = (fact: Fact) =>
  fact.source === "manual" ? "Added by you" : "From conversation";
const dateLabel = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

export function MemorySettings({
  snapshot,
  working,
  perform,
  notice,
  children,
}: {
  snapshot: Snapshot;
  working: boolean;
  perform: (action: () => Promise<unknown>, success?: string) => Promise<void>;
  notice: (message: string) => void;
  children: ReactNode;
}) {
  const character = snapshot.settings.characters.find(
    (c) => c.id === snapshot.settings.activeCharacterId,
  )!;
  const facts = useMemo(
    () =>
      snapshot.facts
        .filter((f) => f.characterId === character.id)
        .sort(
          (a, b) =>
            b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
        ),
    [snapshot.facts, character.id],
  );
  const [search, setSearch] = useState("");
  const [password, setPassword] = useState("");
  const [encrypted, setEncrypted] = useState(true);
  const [map, setMap] = useState<MemoryMap>();
  const projectionRevision = JSON.stringify([
    facts.map((fact) => [fact.id, fact.updatedAt, fact.text]),
    snapshot.settings.providers.embedding.baseUrl,
    snapshot.settings.providers.embedding.model,
  ]);
  useEffect(() => setMap(undefined), [projectionRevision]);
  useEffect(() => {
    setMap(undefined);
    setPassword("");
  }, [character.id]);
  const [view, setView] = useState<"facts" | "history">("facts");
  const [filter, setFilter] = useState<Filter>("all");
  const [limit, setLimit] = useState(12);
  const [selectedId, setSelectedId] = useState<string>();
  const [editingId, setEditingId] = useState<string>();
  const [factText, setFactText] = useState("");
  const [deletingId, setDeletingId] = useState<string>();
  const input = useRef<HTMLTextAreaElement>(null);
  const selected = facts.find((f) => f.id === selectedId) ?? facts[0];
  const editing = facts.find((f) => f.id === editingId);
  const manual = facts.filter((f) => f.source === "manual").length;
  const filtered = facts.filter(
    (f) =>
      (filter === "all" || f.source === filter) &&
      f.text.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  const semantic =
    snapshot.settings.memory.semanticEnabled &&
    snapshot.settings.providers.embedding.enabled;
  useEffect(() => {
    setLimit(12);
  }, [search, filter]);
  useEffect(() => {
    if (editingId && !editing) {
      setEditingId(undefined);
      setFactText("");
    }
  }, [editingId, editing]);
  const focusEditor = () => {
    input.current?.focus({ preventScroll: true });
    input.current?.scrollIntoView({ block: "center", behavior: "instant" });
  };
  const writeMemory = () => {
    if (editingId) {
      setEditingId(undefined);
      setFactText("");
    }
    focusEditor();
  };
  return (
    <div className="memory-workspace">
      <div
        className="memory-view-switch"
        role="group"
        aria-label="Memory views"
      >
        <button
          aria-pressed={view === "facts"}
          onClick={() => setView("facts")}
        >
          <Brain size={15} />
          Saved facts <span>{facts.length}</span>
        </button>
        <button
          aria-pressed={view === "history"}
          onClick={() => setView("history")}
        >
          <MessageCircle size={15} />
          Conversation history
        </button>
      </div>
      {view === "history" ? (
        <ConversationHistory
          notice={notice}
          snapshot={snapshot}
          working={working}
          perform={perform}
        />
      ) : (
        <>
          <section
            className="memory-hero"
            aria-label={`${character.name}’s memory garden`}
          >
            <div className="memory-intro">
              <span className="eyebrow">
                {character.name.toLocaleUpperCase()}’S MEMORY
              </span>
              <h2>
                Little things.
                <br />
                <span>Lasting connections.</span>
              </h2>
              <p>
                The details that make your conversations feel like yours. A
                little more familiar, every time.
              </p>
              <div className="memory-totals">
                <strong>
                  {facts.length}
                  <span>
                    saved {facts.length === 1 ? "memory" : "memories"}
                  </span>
                </strong>
                <span className="memory-recall-state">
                  <i />
                  {semantic ? "Meaning-based recall enabled" : "Keyword recall"}
                </span>
              </div>
              <div
                className="memory-preview"
                aria-live="polite"
                aria-atomic="true"
              >
                {selected ? (
                  <>
                    <span className="eyebrow">A THREAD TO REMEMBER</span>
                    <p>{selected.text}</p>
                    <small>
                      {sourceLabel(selected)} · {dateLabel(selected.updatedAt)}
                    </small>
                  </>
                ) : (
                  <>
                    <span className="eyebrow">
                      ROOM FOR SOMETHING MEANINGFUL
                    </span>
                    <p>
                      A favorite song. Your weekend ritual. The way you take
                      your tea.
                    </p>
                    <small>Start with something you’d like her to know.</small>
                  </>
                )}
              </div>
            </div>
            <MemoryConstellation
              facts={facts}
              selectedId={selected?.id}
              onSelect={setSelectedId}
              projection={map}
            />
          </section>

          <div className="memory-layout">
            <section
              className="card memory-library"
              aria-labelledby="memory-library-title"
            >
              <div className="memory-section-title">
                <div>
                  <span className="eyebrow">COLLECTED ALONG THE WAY</span>
                  <h2 id="memory-library-title">
                    Long-term memories <span>{facts.length}</span>
                  </h2>
                </div>
                <button
                  className="icon-button"
                  title="Write a memory"
                  aria-label="Write a memory"
                  disabled={working}
                  onClick={writeMemory}
                >
                  <Plus size={19} />
                </button>
              </div>
              <div className="memory-search-wrap">
                <Search size={16} aria-hidden="true" />
                <input
                  type="search"
                  placeholder="Find a thought, a preference, a detail…"
                  aria-label="Search memories"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <button
                    className="icon-button"
                    aria-label="Clear memory search"
                    onClick={() => setSearch("")}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              <div
                className="memory-filters"
                role="group"
                aria-label="Filter memories by source"
              >
                {(
                  [
                    ["all", "All memories", facts.length],
                    ["manual", "Added by you", manual],
                    [
                      "conversation",
                      "From conversation",
                      facts.length - manual,
                    ],
                  ] as const
                ).map(([value, label, count]) => (
                  <button
                    key={value}
                    aria-pressed={filter === value}
                    onClick={() => setFilter(value)}
                  >
                    {label}
                    <span>{count}</span>
                  </button>
                ))}
              </div>
              <div className="memory-list-heading">
                <span>
                  {search || filter !== "all"
                    ? `${filtered.length} matching ${filtered.length === 1 ? "memory" : "memories"}`
                    : "Your collection"}
                </span>
                <span>Recently updated first</span>
              </div>
              {!filtered.length && (
                <div className="empty-state">
                  <BookOpen size={30} />
                  <h3>
                    {facts.length
                      ? "No memories here just yet"
                      : "The beginning of knowing you"}
                  </h3>
                  <p>
                    {facts.length
                      ? "Try another search or source filter."
                      : "Add a preference, an interest, or something you’d like her to remember."}
                  </p>
                  {facts.length ? (
                    <button
                      className="text-button"
                      onClick={() => {
                        setSearch("");
                        setFilter("all");
                      }}
                    >
                      Show all memories
                    </button>
                  ) : (
                    <button className="text-button" onClick={writeMemory}>
                      Write the first memory <Plus size={13} />
                    </button>
                  )}
                </div>
              )}
              <div className="memory-list">
                {filtered.slice(0, limit).map((f) => (
                  <article
                    className={`memory-item ${selected?.id === f.id ? "is-selected" : ""}`}
                    key={f.id}
                  >
                    <span
                      className={`memory-source-icon ${f.source}`}
                      aria-hidden="true"
                    >
                      {f.source === "manual" ? (
                        <Pencil size={14} />
                      ) : (
                        <MessageCircle size={14} />
                      )}
                    </span>
                    <div className="memory-item-body">
                      <p>{f.text}</p>
                      <div className="memory-item-meta">
                        <span>{sourceLabel(f)}</span>
                        <time dateTime={f.updatedAt}>
                          {dateLabel(f.updatedAt)}
                        </time>
                      </div>
                      {deletingId === f.id ? (
                        <div className="memory-delete-confirm">
                          <span>Forget this memory?</span>
                          <button
                            className="text-button danger"
                            disabled={working}
                            onClick={() =>
                              void perform(async () => {
                                await bridge.deleteFact(f.id);
                                setDeletingId(undefined);
                              }, "Memory deleted.")
                            }
                          >
                            Confirm delete memory
                          </button>
                          <button
                            className="text-button"
                            disabled={working}
                            onClick={() => setDeletingId(undefined)}
                          >
                            Keep memory
                          </button>
                        </div>
                      ) : (
                        <div className="memory-item-actions">
                          <button
                            className="text-button"
                            disabled={working}
                            onClick={() => {
                              setEditingId(f.id);
                              setFactText(f.text);
                              setSelectedId(f.id);
                              focusEditor();
                            }}
                          >
                            <Pencil size={12} />
                            Edit
                          </button>
                          <button
                            className="icon-button danger"
                            aria-label={`Delete memory: ${f.text}`}
                            title="Delete fact"
                            disabled={working}
                            onClick={() => setDeletingId(f.id)}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
              {filtered.length > limit && (
                <button
                  className="button secondary full"
                  onClick={() => setLimit((v) => v + 12)}
                >
                  Show more memories ({filtered.length - limit} remaining)
                </button>
              )}
            </section>

            <aside className="memory-tools" aria-label="Memory tools">
              <section
                className={`card memory-composer ${editing ? "is-editing" : ""}`}
              >
                <div className="memory-tool-heading">
                  <span className="memory-tool-icon">
                    <Pencil size={17} />
                  </span>
                  <div>
                    <h2>{editing ? "Edit memory" : "Keep a little detail"}</h2>
                    <p>
                      {editing
                        ? "Make it feel more like you."
                        : "Some things are worth remembering."}
                    </p>
                  </div>
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (working || !factText.trim()) return;
                    void perform(async () => {
                      await bridge.saveFact({
                        id: editing?.id,
                        text: factText.trim(),
                      });
                      setFactText("");
                      setEditingId(undefined);
                      setSearch("");
                      setFilter("all");
                      setLimit(12);
                      if (!editing) setSelectedId(undefined);
                    }, "Memory saved.");
                  }}
                >
                  <label className="field">
                    <span>What should she remember?</span>
                    <textarea
                      ref={input}
                      rows={4}
                      maxLength={1000}
                      value={factText}
                      disabled={working}
                      onChange={(e) => setFactText(e.target.value)}
                      placeholder="I like rainy evenings and building cozy houses in Minecraft."
                    />
                  </label>
                  <div className="memory-composer-note">
                    <span>Saved immediately, just for {character.name}.</span>
                    <span>{factText.length}/1000</span>
                  </div>
                  <div className="button-row">
                    <button
                      type="submit"
                      className="button primary"
                      disabled={working || !factText.trim()}
                    >
                      {editing ? <Check size={14} /> : <Plus size={14} />}
                      {editing ? "Update memory" : "Add memory"}
                    </button>
                    {editing && (
                      <button
                        type="button"
                        className="button secondary"
                        disabled={working}
                        onClick={() => {
                          setEditingId(undefined);
                          setFactText("");
                        }}
                      >
                        Cancel edit
                      </button>
                    )}
                  </div>
                </form>
              </section>
              {children}
              <section className="card">
                <h2>A map of meaning</h2>
                <p className="memory-helper">
                  Keep the artistic constellation, or project already-indexed
                  facts with PCA. Connections use actual cosine similarity; 2D
                  distance loses information. No provider calls.
                </p>
                <div className="button-row">
                  <button
                    className="button secondary"
                    disabled={working}
                    onClick={() =>
                      void perform(async () => {
                        const next = await bridge.memoryMap();
                        if (!next.nodes.length)
                          notice(
                            "Index at least two facts with the embedding provider first.",
                          );
                        else setMap(next);
                      })
                    }
                  >
                    Show semantic map
                  </button>
                  <button
                    className="text-button"
                    onClick={() => setMap(undefined)}
                  >
                    Artistic view
                  </button>
                </div>
              </section>
              <MemoryLab
                perform={perform}
                working={working || snapshot.busy}
                notice={notice}
              />
              <section className="card memory-archive">
                <div className="memory-tool-heading">
                  <span className="memory-tool-icon">
                    <BookOpen size={17} />
                  </span>
                  <div>
                    <h2>A keepsake, to take with you</h2>
                    <p>Import or back up {character.name}’s memories.</p>
                  </div>
                </div>
                <label className="memory-helper">
                  <input
                    type="checkbox"
                    checked={encrypted}
                    onChange={(e) => setEncrypted(e.target.checked)}
                  />{" "}
                  Encrypt archive with a passphrase
                </label>
                {encrypted && (
                  <label className="field">
                    <span>Archive passphrase (10+ characters)</span>
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      maxLength={256}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </label>
                )}
                <div className="button-row">
                  <button
                    className="button secondary"
                    disabled={working || snapshot.busy}
                    onClick={() =>
                      void perform(async () => {
                        if (
                          await bridge.importMemory(
                            encrypted && password ? password : undefined,
                          )
                        )
                          notice("Memories imported.");
                        setPassword("");
                      })
                    }
                  >
                    <ArrowUpFromLine size={14} />
                    Import
                  </button>
                  <button
                    className="button secondary"
                    disabled={working || (encrypted && password.length < 10)}
                    onClick={() =>
                      void perform(async () => {
                        if (
                          await bridge.exportMemory(
                            encrypted ? password : undefined,
                          )
                        )
                          notice("Memory archive exported without API keys.");
                        setPassword("");
                      })
                    }
                  >
                    <ArrowDownToLine size={14} />
                    Export
                  </button>
                </div>
                <p className="memory-helper">
                  Imports merge into the saved active character. Archives
                  include facts, chat history and attachments, but no API keys.
                  Keep them somewhere private.
                  {encrypted
                    ? " Passphrases are never saved; there is no recovery if you forget yours."
                    : " This export is readable plaintext."}
                </p>
              </section>
            </aside>
          </div>
        </>
      )}
      <div className="memory-footnote">
        <Brain size={14} />
        <span>
          Memories belong to {character.name}, your saved active character.
          Desktop and Telegram conversations share the same memory.
        </span>
        <Sparkles size={14} />
      </div>
    </div>
  );
}
