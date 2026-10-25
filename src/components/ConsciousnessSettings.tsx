import { useState } from "react";
import { BellPlus, ChevronRight, Pause, Play } from "lucide-react";
import { bridge } from "../bridge";
import { ActivityLog } from "./ActivityLog";
import {
  dimensions,
  initialBehavior,
  type AutonomyConfig,
  type AutonomySnapshot,
  type Levels,
} from "../shared/autonomy";

export function ConsciousnessSettings({
  config,
  data,
  change,
  report,
}: {
  config: AutonomyConfig;
  data?: AutonomySnapshot;
  change: (patch: Partial<AutonomyConfig>) => void;
  report: (error: unknown) => void;
}) {
  const state = data?.state ?? initialBehavior(Date.now());
  const [levels, setLevels] = useState<Levels>(state);
  const [title, setTitle] = useState("");
  const [intent, setIntent] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [working, setWorking] = useState(false);
  const run = async (action: () => Promise<void>) => {
    setWorking(true);
    try {
      await action();
    } catch (error) {
      report(error);
    } finally {
      setWorking(false);
    }
  };
  const toggle = (
    key:
      | "enabled"
      | "proactive"
      | "schedulingTools"
      | "quietEnabled"
      | "expressive",
    label: string,
    hint?: string,
  ) => (
    <label className="toggle-row">
      <div>
        <span>{label}</span>
        {hint && <small id={`${key}-hint`}>{hint}</small>}
      </div>
      <input
        className="toggle"
        type="checkbox"
        aria-label={label}
        aria-describedby={hint ? `${key}-hint` : undefined}
        checked={config[key]}
        onChange={(e) => change({ [key]: e.target.checked })}
      />
    </label>
  );
  const number = (
    key:
      | "initiative"
      | "idleMinutes"
      | "cooldownMinutes"
      | "dailyBudget"
      | "overdueHours"
      | "floor"
      | "ceiling",
    label: string,
    min: number,
    max: number,
    hint?: string,
  ) => (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        aria-label={label}
        aria-describedby={hint ? `${key}-hint` : undefined}
        min={min}
        max={max}
        value={config[key]}
        onChange={(e) => change({ [key]: Number(e.target.value) })}
      />
      {hint && <small id={`${key}-hint`}>{hint}</small>}
    </label>
  );
  const when = (iso: string, timeZone: string) => {
    try {
      return new Date(iso).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone,
      });
    } catch {
      return iso;
    }
  };
  return (
    <>
      <section className="card">
        <div className="section-heading with-actions">
          <div>
            <h2>Her own initiative</h2>
            <p>
              A behavior simulation you can inspect — not real feelings or
              awareness. Changes apply when you save.
            </p>
          </div>
          <button
            className="button secondary"
            disabled={working}
            onClick={() =>
              void run(() => bridge.setAutonomyPaused(!config.paused))
            }
          >
            {config.paused ? <Play size={14} /> : <Pause size={14} />}
            {config.paused ? "Resume autonomy now" : "Pause autonomy now"}
          </button>
        </div>
        <p className="autonomy-gate" role="status">
          <span className={`status-dot ${config.paused ? "paused" : ""}`} />
          Right now: {data?.gate ?? "Desktop required"}
        </p>
        {toggle(
          "enabled",
          "Enable autonomy",
          "Lets her act on her own: start conversations and deliver reminders you’ve approved.",
        )}
        {toggle(
          "proactive",
          "Allow conversation openers",
          "She may say hello first after you’ve been quiet for a while.",
        )}
        {toggle(
          "schedulingTools",
          "Let her propose reminders",
          "While chatting she can suggest reminders; each one waits for your approval below. Needs a model with tool support.",
        )}
        <p className="muted">
          Nothing else runs from here — no games, Telegram or external tools.
          Pausing stops her immediately. Reminders also wait during quiet hours
          or while she’s hidden, listening or speaking, and the app has to be
          open to deliver them.
        </p>
      </section>
      <div className="two-column">
        <section className="card">
          <div className="section-heading">
            <h2>Initiative & limits</h2>
            <p>How often she may act, and when to leave you be.</p>
          </div>
          {number(
            "initiative",
            "Initiative (0–100)",
            0,
            100,
            "Higher means she starts conversations sooner when she’s bored. 0 turns openers off.",
          )}
          <div className="form-grid">
            {number("idleMinutes", "Quiet minutes before an opener", 1, 1440)}
            {number("cooldownMinutes", "Minutes between actions", 1, 1440)}
            {number("dailyBudget", "Attempts per day", 0, 100)}
            {number("overdueHours", "Catch-up window (hours)", 1, 168)}
          </div>
          <p className="muted">
            Limits count reminders and failed attempts, per character and per
            local calendar day. An overdue reminder is still delivered within
            the catch-up window.
          </p>
          {toggle(
            "quietEnabled",
            "Respect quiet hours",
            "No openers or reminders during these hours. The same start and end means quiet all day.",
          )}
          <div className="form-grid">
            <label className="field">
              <span>Quiet hours start</span>
              <input
                type="time"
                value={config.quietStart}
                onChange={(e) => change({ quietStart: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Quiet hours end</span>
              <input
                type="time"
                value={config.quietEnd}
                onChange={(e) => change({ quietEnd: e.target.value })}
              />
            </label>
          </div>
          <label className="field">
            <span>Time zone (IANA)</span>
            <input
              aria-label="Time zone (IANA)"
              aria-describedby="time-zone-hint"
              value={config.timeZone}
              onChange={(e) => change({ timeZone: e.target.value })}
              placeholder="Europe/Moscow"
            />
            <small id="time-zone-hint">Follows daylight saving changes.</small>
          </label>
        </section>
        <section className="card">
          <div className="section-heading">
            <h2>Her mood right now</h2>
            <p>{state.reason}</p>
          </div>
          {dimensions.map((key) => (
            <div key={key} className="field mood-dimension">
              <label htmlFor={`state-${key}`}>
                <span>{key[0].toUpperCase() + key.slice(1)}</span>
                <small>now {Math.round(state[key])}</small>
              </label>
              <div className="range">
                <input
                  id={`state-${key}`}
                  aria-label={`Set ${key}`}
                  type="range"
                  min={config.floor}
                  max={config.ceiling}
                  value={levels[key]}
                  onChange={(e) =>
                    setLevels({ ...levels, [key]: Number(e.target.value) })
                  }
                />
                <output>{Math.round(levels[key])}</output>
              </div>
            </div>
          ))}
          <div className="button-row">
            <button
              className="button secondary"
              disabled={working}
              onClick={() => void run(() => bridge.setBehavior(levels))}
            >
              Apply these values
            </button>
            <button className="text-button" onClick={() => setLevels(state)}>
              Reset sliders
            </button>
          </div>
          <p className="muted">
            Mood drifts back toward neutral over time. Trust and affinity grow
            slowly through conversation, never drop as a punishment for being
            away, and don’t describe your feelings.
          </p>
          {toggle(
            "expressive",
            "Mood expressions and gestures",
            "Her face and small gestures follow her mood. Appearance animations still work.",
          )}
          <details className="avatar-credits">
            <summary>
              Value range
              <ChevronRight size={15} />
            </summary>
            <div className="form-grid">
              {number("floor", "Minimum state value", 0, 49)}
              {number("ceiling", "Maximum state value", 51, 100)}
            </div>
            <p className="hint">Save a new range before applying values.</p>
          </details>
        </section>
      </div>
      <section className="card">
        <div className="section-heading">
          <h2>Scheduled reminders</h2>
          <p>
            Reminders you create here are approved right away; ones she suggests
            wait for you. Autonomy must be on for delivery.
          </p>
        </div>
        <form
          className="reminder-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await bridge.createTask({
                title,
                intent,
                dueAt,
                timeZone: config.timeZone,
              });
              setTitle("");
              setIntent("");
              setDueAt("");
            });
          }}
        >
          <div className="form-grid">
            <label className="field">
              <span>Reminder title</span>
              <input
                required
                maxLength={100}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Exact reminder time (ISO with offset)</span>
              <input
                required
                aria-label="Exact reminder time (ISO with offset)"
                aria-describedby="due-at-hint"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                placeholder="2026-09-13T18:30:00+03:00"
              />
              <small id="due-at-hint">
                Include Z or an offset like +03:00; up to a year ahead. Shown in{" "}
                {config.timeZone}.
              </small>
            </label>
          </div>
          <label className="field">
            <span>What should she remind you about?</span>
            <textarea
              required
              rows={3}
              maxLength={1000}
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
            />
          </label>
          <button className="button primary" disabled={working}>
            <BellPlus size={15} />
            Create authorized reminder
          </button>
        </form>
        {!data?.tasks.length && (
          <p className="muted">No reminders scheduled.</p>
        )}
        <div className="task-list">
          {data?.tasks
            .slice()
            .reverse()
            .map((task) => (
              <article className="task-item" key={task.id}>
                <div>
                  <strong>{task.title}</strong>
                  <p>{task.intent}</p>
                  <small>
                    <span className={`task-status ${task.status}`}>
                      {taskStatusLabel[task.status]}
                    </span>
                    {when(task.dueAt, task.timeZone)} · {task.timeZone}
                    {task.outcome && ` · ${task.outcome}`}
                  </small>
                </div>
                <div className="button-row">
                  {task.status === "approval" && (
                    <button
                      className="button primary"
                      aria-label={`Approve ${task.title}`}
                      disabled={working}
                      onClick={() =>
                        void run(() => bridge.taskAction(task.id, "approve"))
                      }
                    >
                      Approve
                    </button>
                  )}
                  {["approval", "pending", "running"].includes(task.status) && (
                    <button
                      className="button secondary"
                      aria-label={`Cancel ${task.title}`}
                      disabled={working}
                      onClick={() =>
                        void run(() => bridge.taskAction(task.id, "cancel"))
                      }
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </article>
            ))}
        </div>
      </section>
      <ActivityLog key={data?.characterId} data={data} report={report} />
    </>
  );
}

const taskStatusLabel: Record<string, string> = {
  approval: "Needs approval",
  pending: "Scheduled",
  running: "Delivering",
  done: "Done",
  cancelled: "Cancelled",
  missed: "Missed",
  failed: "Failed",
};
