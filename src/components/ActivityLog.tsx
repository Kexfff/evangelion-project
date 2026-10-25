import { useEffect, useRef, useState } from "react";
import { bridge } from "../bridge";
import type { ActivityPage, AutonomySnapshot } from "../shared/autonomy";

export function ActivityLog({
  data,
  report,
}: {
  data?: AutonomySnapshot;
  report: (error: unknown) => void;
}) {
  const [older, setOlder] = useState<ActivityPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState("");
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  const latest = data?.activity.slice(0, 10) ?? [];
  const total = data?.activityTotal ?? latest.length;
  const page = older ?? {
    entries: latest,
    total,
    hasMore: total > latest.length,
  };
  const loadOlder = async () => {
    if (!data?.characterId || !page.entries.length) return;
    const token = ++request.current;
    setLoading(true);
    try {
      const result = await bridge.listActivity({
        characterId: data.characterId,
        before: page.entries.at(-1)!.id,
      });
      if (token === request.current) setOlder(result);
    } catch (error) {
      if (token === request.current) report(error);
    } finally {
      if (token === request.current) setLoading(false);
    }
  };
  const exportLogs = async () => {
    setExporting(true);
    setNotice("");
    try {
      setNotice(
        (await bridge.exportActivity())
          ? "Activity logs exported."
          : "Export cancelled; no file written.",
      );
    } catch (error) {
      report(error);
    } finally {
      setExporting(false);
    }
  };
  return (
    <section className="card" aria-label="Activity log">
      <div className="section-heading">
        <h2>Activity log</h2>
        <p>
          What she did on her own, newest first. {total} events kept for this
          character (up to 500 across all). Costs are what your language model
          service reported; voice and embedding usage isn’t included.
        </p>
      </div>
      <div className="button-row">
        <button
          className="button secondary"
          disabled={exporting}
          onClick={() => void exportLogs()}
        >
          {exporting ? "Exporting…" : "Export all logs"}
        </button>
        {older && (
          <button
            className="button secondary"
            onClick={() => {
              ++request.current;
              setLoading(false);
              setOlder(null);
            }}
          >
            Latest 10
          </button>
        )}
        {page.hasMore && (
          <button
            className="button secondary"
            disabled={loading || !data?.characterId}
            onClick={() => void loadOlder()}
          >
            {loading ? "Loading…" : "Older 10"}
          </button>
        )}
      </div>
      <p className="muted">
        Export covers every character, not just this page. Diagnostics leave out
        prompts, keys and raw responses, but event descriptions can mention
        reminder titles — check before sharing.
      </p>
      {notice && <p role="status">{notice}</p>}
      {older && (
        <p className="muted">
          Viewing older events. Choose Latest 10 to return to live activity.
        </p>
      )}
      {!page.entries.length && (
        <p className="muted">
          {older
            ? "These older entries are no longer retained. Return to Latest 10."
            : "No activity yet."}
        </p>
      )}
      {page.entries.map((entry) => (
        <article className="log-entry" key={entry.id}>
          <div>
            <strong>{entry.kind}</strong>
            <p>{entry.detail}</p>
            <small>
              {new Date(entry.at).toLocaleString()} · requests: {entry.requests}{" "}
              · tokens: {entry.tokens ?? "not reported"} · cost:{" "}
              {entry.cost === undefined ? "not reported" : `$${entry.cost}`}
            </small>
            {entry.diagnostic && (
              <details>
                <summary>
                  Diagnostic details · {entry.diagnostic.stage} ·{" "}
                  {(entry.diagnostic.elapsedMs / 1000).toFixed(2)}s
                  {entry.diagnostic.httpStatus
                    ? ` · HTTP ${entry.diagnostic.httpStatus}`
                    : ""}
                </summary>
                <pre>{JSON.stringify(entry.diagnostic, null, 2)}</pre>
              </details>
            )}
          </div>
        </article>
      ))}
    </section>
  );
}
