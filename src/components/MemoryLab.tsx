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
          <p>Try a question and see what she would recall.</p>
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void perform(async () =>
            setResults(await bridge.inspectMemory(query, semantic)),
          );
        }}
      >
        <label className="field">
          <span>Ask her memory</span>
          <input
            value={query}
            maxLength={4000}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="What did we plan for our house?"
          />
        </label>
        <label className="toggle-row">
          <div>
            <span>Search by meaning too</span>
            <small id="recall-semantic-hint">
              Sends your question to the Remember service.
            </small>
          </div>
          <input
            className="toggle"
            aria-label="Search by meaning too"
            aria-describedby="recall-semantic-hint"
            type="checkbox"
            checked={semantic}
            onChange={(e) => setSemantic(e.target.checked)}
          />
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
            <p>
              No relevant memories found. The current conversation is left out.
            </p>
          )}
        </div>
      )}
      <div className="memory-lab-block">
        <h3>Summarize an older conversation</h3>
        <p className="memory-helper">
          Conversations are kept as excerpts. A summary condenses decisions and
          open plans from the oldest one not yet summarized; the original stays,
          and summaries aren’t treated as verified facts. Uses one request to
          your language model per 40 messages. Nothing runs on its own.
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
      </div>
      <details className="memory-maintenance">
        <summary>
          <ShieldCheck size={15} /> Privacy & housekeeping
        </summary>
        <p className="memory-helper">
          Nothing expires on its own. Remove old conversations and finished
          reminders here; saved facts, upcoming reminders and the current
          conversation always stay. Use 0 to keep everything.
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
          Cleanup also refreshes the rolling backup and removes unused
          attachments. It can’t reach exported files, system backups or copies
          already sent to AI services, and isn’t a forensic secure erase.
        </p>
      </details>
    </section>
  );
}
