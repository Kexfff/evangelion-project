import { useState } from "react";
import { bridge } from "../bridge";
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
  ) => (
    <label className="toggle-row">
      <span>{label}</span>
      <input
        className="toggle"
        type="checkbox"
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
  ) => (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={config[key]}
        onChange={(e) => change({ [key]: Number(e.target.value) })}
      />
    </label>
  );
  return (
    <>
      <section className="card">
        <div className="section-heading">
          <h2>A spark of her own</h2>
          <p>
            Inspectable behavioral simulation, not actual sentience. Settings
            below take effect when you Save changes.
          </p>
        </div>
        {toggle("enabled", "Enable autonomy")}
        {toggle("proactive", "Allow conversation openers")}
        {toggle("schedulingTools", "Allow LLM scheduling tools")}
        <p className="muted">
          LLM-created reminders require individual approval below. No PC, game,
          Telegram or MCP actions run here. Scheduling tools require a
          tool-capable model; their replies are buffered until the bounded tool
          loop finishes.
        </p>
        <p role="status">Current policy: {data?.gate ?? "Desktop required"}</p>
        <button
          disabled={working}
          onClick={() =>
            void run(() => bridge.setAutonomyPaused(!config.paused))
          }
        >
          {config.paused ? "Resume autonomy now" : "Pause autonomy now"}
        </button>
        <p className="muted">
          Pause is immediate and stops autonomous generation/playback. Reminders
          are deferred while paused, in quiet hours, or while the companion is
          hidden, typing, listening or speaking. Keep the app open; it cannot
          wake a powered-off computer.
        </p>
      </section>
      <div className="two-column">
        <section className="card">
          <div className="section-heading">
            <h2>Initiative & limits</h2>
          </div>
          {number("initiative", "Initiative (0–100)", 0, 100)}
          {number(
            "idleMinutes",
            "Idle minutes before a conversation opener",
            1,
            1440,
          )}
          {number(
            "cooldownMinutes",
            "Cooldown between autonomous actions (minutes)",
            1,
            1440,
          )}
          {number("dailyBudget", "Maximum autonomous attempts per day", 0, 100)}
          {number("overdueHours", "Overdue catch-up window (hours)", 1, 168)}
          <p className="muted">
            Limits include reminders and failed attempts. Initiative requires
            boredom ≥ 100 − initiative and energy ≥ 20. Zero initiative disables
            openers. Cooldown and limits are per character, using the configured
            local calendar day.
          </p>
          {toggle("quietEnabled", "Respect quiet hours")}
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
          <label className="field">
            <span>Time zone (IANA)</span>
            <input
              value={config.timeZone}
              onChange={(e) => change({ timeZone: e.target.value })}
              placeholder="Europe/Moscow"
            />
          </label>
          <p className="muted">
            Equal start/end means quiet all day. Time zones follow daylight
            saving rules; exact reminder timestamps keep their original instant.
          </p>
        </section>
        <section className="card">
          <div className="section-heading">
            <h2>Behavior state</h2>
          </div>
          <p>{state.reason}</p>
          <p className="muted">
            Trust and affinity grow slowly through conversation, never decrease
            as punishment for absence, and do not represent the user's feelings.
          </p>
          {dimensions.map((key) => (
            <div key={key} className="field">
              <label htmlFor={`state-${key}`}>
                {key} · current {state[key].toFixed(1)}
              </label>
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
            </div>
          ))}
          <button
            disabled={working}
            onClick={() => void run(() => bridge.setBehavior(levels))}
          >
            Apply state values now
          </button>
          <button onClick={() => setLevels(state)}>Use current values</button>
          {number("floor", "Minimum state value", 0, 49)}
          {number("ceiling", "Maximum state value", 51, 100)}
          {toggle("expressive", "Mood expressions and gestures")}
          <p className="muted">
            Save bounds before applying state values. Mood eases toward neutral
            with time. Idle drift is capped at six hours per update. Expression
            intensity is subtle; manual Avatar studio animation selection
            remains available.
          </p>
        </section>
      </div>
      <section className="card">
        <div className="section-heading">
          <h2>Scheduled reminders</h2>
        </div>
        <form
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
            <span>What should she remind you about?</span>
            <textarea
              required
              maxLength={1000}
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Exact reminder time (ISO with offset)</span>
            <input
              required
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              placeholder="2026-09-13T18:30:00+03:00"
            />
          </label>
          <p className="muted">
            Include Z or an explicit offset, within one year. Display zone:{" "}
            {config.timeZone}. This button authorizes this reminder; global
            autonomy must also be enabled for delivery.
          </p>
          <button className="primary" disabled={working}>
            Create authorized reminder
          </button>
        </form>
        {!data?.tasks.length && <p className="muted">No scheduled tasks.</p>}
        {data?.tasks
          .slice()
          .reverse()
          .map((task) => (
            <article className="memory-item" key={task.id}>
              <div>
                <strong>{task.title}</strong>
                <p>{task.intent}</p>
                <small>
                  {task.status} · {task.dueAt} · {task.timeZone}
                  <br />
                  {task.id}
                  <br />
                  {task.outcome}
                </small>
              </div>
              <div className="row-actions">
                {task.status === "approval" && (
                  <button
                    disabled={working}
                    onClick={() =>
                      void run(() => bridge.taskAction(task.id, "approve"))
                    }
                  >
                    Approve {task.title}
                  </button>
                )}
                {["approval", "pending", "running"].includes(task.status) && (
                  <button
                    disabled={working}
                    onClick={() =>
                      void run(() => bridge.taskAction(task.id, "cancel"))
                    }
                  >
                    Cancel {task.title}
                  </button>
                )}
              </div>
            </article>
          ))}
      </section>
      <section className="card">
        <div className="section-heading">
          <h2>Activity log</h2>
          <p>
            Latest 100 events for this character (500 retained globally). Costs
            below are provider-reported LLM usage, not estimates;
            audio/embedding usage is not included.
          </p>
        </div>
        {!data?.activity.length && <p className="muted">No activity yet.</p>}
        {data?.activity.map((entry) => (
          <article className="memory-item" key={entry.id}>
            <div>
              <strong>{entry.kind}</strong>
              <p>{entry.detail}</p>
              <small>
                {entry.at} · requests: {entry.requests} · tokens:{" "}
                {entry.tokens ?? "not reported"} · cost:{" "}
                {entry.cost === undefined ? "not reported" : `$${entry.cost}`}
              </small>
            </div>
          </article>
        ))}
      </section>
    </>
  );
}
