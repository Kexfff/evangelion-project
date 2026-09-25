import { useEffect, useState } from "react";
import {
  Archive,
  ArrowDownToLine,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  MessageCircle,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { bridge } from "../bridge";
import {
  HISTORY_PAGE_SIZE,
  type ConversationPage,
  type HistoryPage,
  type HistoryQuery,
} from "../shared/history";
import type { Snapshot } from "../shared/schema";

const date = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
const time = (value: string) =>
  new Date(value).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message.replace(
        /^Error invoking remote method '[^']+': (?:Error: )?/,
        "",
      )
    : "History could not be loaded.";

function HistoryAttachment({
  characterId,
  sessionId,
  messageId,
  index,
  name,
}: {
  characterId: string;
  sessionId: string;
  messageId: string;
  index: number;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) {
      setUrl("");
      return;
    }
    let active = true;
    setError("");
    void bridge
      .readHistoryImage({ characterId, sessionId, messageId, index })
      .then((image) => {
        if (active) setUrl(image.dataUrl);
      })
      .catch((err) => {
        if (active) setError(errorText(err));
      });
    return () => {
      active = false;
    };
  }, [open, characterId, sessionId, messageId, index]);
  return (
    <div className="history-attachment">
      <button
        className="text-button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <ImageIcon size={14} />
        {open ? "Close image" : "View image"}: {name}
      </button>
      {open &&
        (error ? (
          <p role="alert">{error}</p>
        ) : url ? (
          <img src={url} alt={name} />
        ) : (
          <p role="status">Loading image…</p>
        ))}
    </div>
  );
}

function Pages({
  offset,
  total,
  label,
  change,
}: {
  offset: number;
  total: number;
  label: string;
  change: (offset: number) => void;
}) {
  if (total <= HISTORY_PAGE_SIZE) return null;
  return (
    <div className="history-pagination">
      <button
        className="icon-button"
        aria-label={`Previous ${label}`}
        disabled={!offset}
        onClick={() => change(Math.max(0, offset - HISTORY_PAGE_SIZE))}
      >
        <ChevronLeft size={16} />
      </button>
      <span>
        {offset + 1}–{Math.min(offset + HISTORY_PAGE_SIZE, total)} of {total}
      </span>
      <button
        className="icon-button"
        aria-label={`Next ${label}`}
        disabled={offset + HISTORY_PAGE_SIZE >= total}
        onClick={() => change(offset + HISTORY_PAGE_SIZE)}
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

export function ConversationHistory({
  snapshot,
  working,
  perform,
  notice,
}: {
  snapshot: Snapshot;
  working: boolean;
  perform: (action: () => Promise<unknown>, success?: string) => Promise<void>;
  notice: (message: string) => void;
}) {
  const characterId = snapshot.settings.activeCharacterId;
  const character = snapshot.settings.characters.find(
    (c) => c.id === characterId,
  )!;
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState<HistoryQuery["channel"]>("all");
  const [offset, setOffset] = useState(0);
  const [messageOffset, setMessageOffset] = useState(0);
  const [selected, setSelected] = useState<string>();
  const [page, setPage] = useState<HistoryPage>();
  const [conversation, setConversation] = useState<
    ConversationPage & { key: string }
  >();
  const [onlyMatches, setOnlyMatches] = useState(true);
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [revision, setRevision] = useState(0);
  const filtered = !!search.trim() || channel !== "all";
  const readerSearch = onlyMatches ? search.trim() : "";
  const readerChannel = onlyMatches ? channel : "all";
  const conversationKey = JSON.stringify([
    characterId,
    selected,
    readerSearch,
    readerChannel,
    messageOffset,
  ]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      void bridge
        .listHistory({ characterId, search: search.trim(), channel, offset })
        .then((result) => {
          if (!active) return;
          if (!result.sessions.length && offset > 0) {
            setOffset(0);
            return;
          }
          setPage(result);
          setSelected((previous) =>
            result.sessions.some((s) => s.id === previous)
              ? previous
              : result.sessions[0]?.id,
          );
          setLoading(false);
        })
        .catch((err) => {
          if (active) {
            setError(errorText(err));
            setPage(undefined);
            setSelected(undefined);
            setLoading(false);
          }
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [characterId, search, channel, offset, snapshot, revision]);
  useEffect(() => {
    setMessageOffset(0);
    setOnlyMatches(true);
  }, [selected, search, channel]);
  useEffect(() => {
    if (!selected || loading) return;
    let active = true;
    setReading(true);
    setReadError("");
    void bridge
      .readConversation({
        characterId,
        sessionId: selected,
        search: readerSearch,
        channel: readerChannel,
        offset: messageOffset,
      })
      .then((result) => {
        if (!active) return;
        if (!result.messages.length && messageOffset > 0) {
          setMessageOffset(0);
          return;
        }
        setConversation({ ...result, key: conversationKey });
        setReading(false);
      })
      .catch((err) => {
        if (active) {
          setReadError(errorText(err));
          setConversation(undefined);
          setReading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [
    characterId,
    selected,
    readerSearch,
    readerChannel,
    conversationKey,
    messageOffset,
    loading,
    snapshot,
    revision,
  ]);
  const summary = page?.sessions.find((s) => s.id === selected);
  const resetFilters = () => {
    setSearch("");
    setChannel("all");
    setOffset(0);
    setMessageOffset(0);
  };
  return (
    <section className="card history-workspace" aria-labelledby="history-title">
      <div className="history-heading">
        <div>
          <span className="eyebrow">THE CONVERSATIONS THAT STAY</span>
          <h2 id="history-title">Conversation history</h2>
          <p>
            Revisit your conversations with {character.name}. Browsing here
            won’t change your active chat.
          </p>
        </div>
        <button
          className="button primary"
          disabled={working || snapshot.busy}
          onClick={() =>
            void perform(
              () => bridge.newSession(),
              "New conversation started. Previous conversations and facts are kept.",
            )
          }
        >
          <Plus size={15} />
          New conversation
        </button>
      </div>
      <div className="history-summary">
        <span>
          <Archive size={15} />
          {page
            ? `${page.totalSessions} saved ${page.totalSessions === 1 ? "conversation" : "conversations"}`
            : "Saved conversations"}
        </span>
        <span>
          <MessageCircle size={15} />
          {page ? `${page.totalMessages} messages` : "Your message archive"}
        </span>
        <small>Separate from saved facts · stored on this device</small>
      </div>
      <div className="history-toolbar">
        <div className="memory-search-wrap">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            maxLength={200}
            aria-label="Search conversation history"
            placeholder="Search messages or attachment names…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
              setMessageOffset(0);
            }}
          />
          {search && (
            <button
              className="icon-button"
              aria-label="Clear history search"
              onClick={() => {
                setSearch("");
                setOffset(0);
                setMessageOffset(0);
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div
          className="memory-filters"
          role="group"
          aria-label="Filter conversation channels"
        >
          {(
            [
              ["all", "All channels"],
              ["desktop", "Desktop"],
              ["telegram", "Telegram"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              aria-pressed={channel === id}
              onClick={() => {
                setChannel(id);
                setOffset(0);
                setMessageOffset(0);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {error ? (
        <div className="history-feedback" role="alert">
          <p>{error}</p>
          <button
            className="text-button"
            onClick={() => setRevision((v) => v + 1)}
          >
            Retry loading history
          </button>
        </div>
      ) : loading ? (
        <p className="history-feedback" role="status">
          Opening your conversation archive…
        </p>
      ) : !page?.sessions.length ? (
        <div className="empty-state">
          <MessageCircle size={30} />
          <h3>
            {filtered
              ? "No matching conversations"
              : "Your story starts with a hello"}
          </h3>
          <p>
            {filtered
              ? "Try different words or another channel. Your saved history hasn’t changed."
              : "Messages from desktop and Telegram will appear here, even if no facts have been saved yet."}
          </p>
          {filtered && (
            <button className="text-button" onClick={resetFilters}>
              Clear history filters
            </button>
          )}
        </div>
      ) : (
        <div className="history-browser">
          <div className="history-session-panel">
            <div className="history-panel-label">
              {filtered
                ? `${page.total} matching conversations`
                : "Most recent first"}
            </div>
            <div
              className="history-session-list"
              role="group"
              aria-label="Saved conversations"
            >
              {page.sessions.map((session) => (
                <button
                  key={session.id}
                  className={`history-session ${selected === session.id ? "selected" : ""}`}
                  aria-pressed={selected === session.id}
                  onClick={() => {
                    setSelected(session.id);
                    setMessageOffset(0);
                  }}
                >
                  <div className="history-session-meta">
                    <time dateTime={session.lastAt}>
                      {date(session.lastAt)}
                    </time>
                    {session.current && <span>Active chat</span>}
                  </div>
                  <strong>{session.title}</strong>
                  <p>{session.preview}</p>
                  <div className="history-session-details">
                    <span>
                      {filtered
                        ? `${session.matches} matches`
                        : `${session.count} messages`}
                    </span>
                    <span>
                      {session.channels
                        .map((c) => (c === "telegram" ? "Telegram" : "Desktop"))
                        .join(" + ")}
                    </span>
                    {session.images > 0 && (
                      <span>
                        <ImageIcon size={11} />
                        {session.images}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
            <Pages
              offset={offset}
              total={page.total}
              label="conversations"
              change={setOffset}
            />
          </div>
          <div className="history-reader" aria-label="Conversation messages">
            <div className="history-reader-heading">
              <span className="eyebrow">
                {summary?.current ? "ACTIVE CONVERSATION" : "PAST CONVERSATION"}{" "}
                · READ ONLY
              </span>
              <h3>{summary?.title}</h3>
              <p>
                {summary &&
                  `${date(summary.firstAt)} · ${summary.count} messages`}
                {filtered && onlyMatches
                  ? " · Showing matching messages only"
                  : " · Oldest first"}
              </p>
              {filtered && (
                <button
                  className="text-button"
                  onClick={() => {
                    setOnlyMatches(!onlyMatches);
                    setMessageOffset(0);
                  }}
                >
                  {onlyMatches
                    ? "Read full conversation"
                    : "Show matching messages"}
                </button>
              )}
            </div>
            {reading ||
            (!readError && conversation?.key !== conversationKey) ? (
              <p role="status" className="history-feedback">
                Loading messages…
              </p>
            ) : readError ? (
              <div className="history-feedback" role="alert">
                <p>{readError}</p>
                <button
                  className="text-button"
                  onClick={() => setRevision((v) => v + 1)}
                >
                  Retry loading messages
                </button>
              </div>
            ) : (
              <>
                <div
                  className="history-messages"
                  role="region"
                  aria-label="Message transcript"
                  tabIndex={0}
                  key={`${selected}:${messageOffset}:${search}:${channel}`}
                >
                  {conversation?.messages.map((message, i, messages) => (
                    <div key={message.id}>
                      {(i === 0 ||
                        date(message.createdAt) !==
                          date(messages[i - 1].createdAt)) && (
                        <div className="history-day">
                          {date(message.createdAt)}
                        </div>
                      )}
                      <article className={`history-message ${message.role}`}>
                        <header>
                          <strong>
                            {message.role === "user" ? "You" : character.name}
                          </strong>
                          <span>
                            {message.channel === "telegram"
                              ? "Telegram"
                              : "Desktop"}
                            {message.origin === "reminder"
                              ? " · Reminder"
                              : message.origin === "initiative"
                                ? " · Conversation opener"
                                : ""}
                          </span>
                          <time dateTime={message.createdAt}>
                            {time(message.createdAt)}
                          </time>
                        </header>
                        {message.content && <p>{message.content}</p>}
                        {message.images.map((image, index) => (
                          <HistoryAttachment
                            key={`${message.id}:${index}`}
                            characterId={characterId}
                            sessionId={message.sessionId}
                            messageId={message.id}
                            index={index}
                            name={image.name}
                          />
                        ))}
                      </article>
                    </div>
                  ))}
                </div>
                {conversation && (
                  <Pages
                    offset={messageOffset}
                    total={conversation.total}
                    label="messages"
                    change={setMessageOffset}
                  />
                )}
              </>
            )}
          </div>
        </div>
      )}
      <div className="history-footer">
        <p>
          Starting fresh keeps earlier conversations available for recall.
          Export a backup before deleting history; saved facts are kept.
        </p>
        <button
          className="button secondary"
          disabled={working}
          onClick={() =>
            void perform(async () => {
              if (await bridge.exportMemory())
                notice("Memory archive exported without API keys.");
            })
          }
        >
          <ArrowDownToLine size={14} />
          Export archive
        </button>
        <button
          className="text-button danger"
          disabled={working || snapshot.busy || !page?.totalMessages}
          onClick={() => void perform(() => bridge.clearHistory())}
        >
          <Trash2 size={13} />
          Delete conversation history…
        </button>
      </div>
    </section>
  );
}
