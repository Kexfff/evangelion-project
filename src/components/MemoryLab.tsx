import { useState } from "react";
import { Search, ShieldCheck, Sparkles } from "lucide-react";
import { bridge } from "../bridge";
import type { RecallResult } from "../shared/memory-tools";

export function MemoryLab({
  perform,
  working,
  notice,
}: {
  perform: (action: () => Promise<unknown>, success?: string) => Promise<void>;
  working: boolean;
  notice: (text: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [semantic, setSemantic] = useState(false);
  const [results, setResults] = useState<RecallResult[] | null>(null);
  const [days, setDays] = useState(0),
    [taskDays, setTaskDays] = useState(0);
  return (
    <section className="card memory-lab">
      <div className="memory-tool-heading">
        <span className="memory-tool-icon">
          <Sparkles size={17} />
        </span>
        <div>
          <h2>Inside her memory</h2>
          <p>Try a question. See the threads she would recall.</p>
        </div>
      </div>
      <p className="memory-helper">
        Local digests keep attributed conversation excerpts. For a more compact
        summary of decisions and open plans, consolidate an older conversation.
        Originals stay intact; generated summaries are not treated as verified
        facts.
      </p>
      <button
        className="button secondary"
        disabled={working}
        onClick={() =>
          void perform(async () => notice(await bridge.consolidateMemory()))
        }
      >
        Consolidate next conversation
      </button>
      <p className="memory-helper">
        One request to your saved LLM per group (up to 40 messages); provider
        charges may apply. Nothing runs automatically.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void perform(async () =>
            setResults(await bridge.inspectMemory(query, semantic)),
          );
        }}
      >
        <label className="field">
          <span>Recall playground</span>
          <input
            value={query}
            maxLength={4000}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="What did we plan for our house?"
          />
        </label>
        <label className="memory-helper">
          <input
            type="checkbox"
            checked={semantic}
            onChange={(e) => setSemantic(e.target.checked)}
          />{" "}
          Include semantic search (embedding provider requests)
        </label>
        <button
          className="button secondary"
          disabled={working || !query.trim()}
        >
          <Search size={14} /> Test recall
        </button>
      </form>
      {results && (
        <div className="recall-results" aria-live="polite">
          {results.length ? (
            results.map((r) => (
              <article key={r.id}>
                <small>
                  {r.kind} · {r.reason} ·{" "}
                  {new Date(r.date).toLocaleDateString()}
                </small>
                <p>{r.text}</p>
              </article>
            ))
          ) : (
            <p>No relevant memories found. The active context is excluded.</p>
          )}
        </div>
      )}
      <details className="memory-maintenance">
        <summary>
          <ShieldCheck size={15} /> Privacy & housekeeping
        </summary>
        <p className="memory-helper">
          Nothing expires automatically. Keep all (0), or remove old
          conversations and finished reminders. Saved facts, pending reminders
          and the active conversation are kept.
        </p>
        <label className="field">
          <span>History age in days (0 = keep all)</span>
          <input
            type="number"
            min={0}
            max={36500}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          />
        </label>
        <label className="field">
          <span>Finished reminder age in days (0 = keep all)</span>
          <input
            type="number"
            min={0}
            max={36500}
            value={taskDays}
            onChange={(e) => setTaskDays(Number(e.target.value))}
          />
        </label>
        <button
          className="button secondary"
          disabled={working}
          onClick={() =>
            void perform(async () =>
              notice(
                await bridge.maintainMemory({ historyDays: days, taskDays }),
              ),
            )
          }
        >
          Review cleanup…
        </button>
        <p className="memory-helper">
          Also refreshes the rolling backup and removes unused attachments.
          Cannot erase external exports, OS snapshots or copies already sent to
          providers. Not forensic secure erasure.
        </p>
      </details>
    </section>
  );
}
