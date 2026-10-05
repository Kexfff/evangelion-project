import { useEffect, useState } from "react";
import { Flag, Pause, Play, X } from "lucide-react";
import { bridge } from "../bridge";
import { MinecraftDiagnostics } from "./MinecraftDiagnostics";
import { gameGoalConfigSchema } from "../shared/game-goals";
import type { MinecraftSnapshot } from "../shared/minecraft";

export function GameGoals({ data }: { data?: MinecraftSnapshot }) {
  const [config, setConfig] = useState(
    data?.goalConfig ?? gameGoalConfigSchema.parse({}),
  );
  const saved = JSON.stringify(data?.goalConfig);
  useEffect(
    () => setConfig(data?.goalConfig ?? gameGoalConfigSchema.parse({})),
    [saved],
  );
  const [objective, setObjective] = useState(""),
    [item, setItem] = useState("stone_pickaxe"),
    [count, setCount] = useState(1),
    [mode, setMode] = useState("queue"),
    [due, setDue] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Game goal operation failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="game-goals">
      <div className="integration-section-title">
        <Flag size={17} />
        <h3>Game goals</h3>
        <span className="connection-badge">Beyond one action</span>
      </div>
      <p>
        Queue a plan and keep chatting. Each step waits for the previous
        outcome. Direct game commands pause active plans; Stop cancels them.
      </p>
      {error && (
        <p className="error-notice" role="alert">
          {error}
        </p>
      )}
      {(data?.goals ?? []).length ? (
        <ol className="minecraft-jobs">
          {[...(data?.goals ?? [])]
            .reverse()
            .slice(0, 16)
            .map((g) => (
              <li key={g.id} data-status={g.status}>
                <strong>{g.objective}</strong>
                <span className="connection-badge">{g.status}</span>
                <p>{g.detail}</p>
                <small>
                  {g.steps} steps · {g.requests} planning requests · $
                  {g.cost.toFixed(4)} reported · {g.source}
                  {g.dueAt
                    ? ` · scheduled ${new Date(g.dueAt).toLocaleString()}`
                    : ""}
                </small>
                {["running", "queued", "paused"].includes(g.status) && (
                  <div className="button-row">
                    {g.status === "paused" ? (
                      <button
                        className="button secondary"
                        disabled={busy || !data?.live.connected}
                        onClick={() => {
                          if (
                            window.confirm(
                              "Confirm this is the same Minecraft world. Resume will inspect current state, not blindly replay the last action.",
                            )
                          )
                            void run(() =>
                              bridge.controlGameGoal(g.id, "resume"),
                            );
                        }}
                      >
                        <Play size={13} />
                        Resume goal
                      </button>
                    ) : (
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() =>
                          void run(() => bridge.controlGameGoal(g.id, "pause"))
                        }
                      >
                        <Pause size={13} />
                        Pause goal
                      </button>
                    )}
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() =>
                        void run(() => bridge.controlGameGoal(g.id, "cancel"))
                      }
                    >
                      <X size={13} />
                      Cancel goal
                    </button>
                  </div>
                )}
                {!!g.history.length && (
                  <details>
                    <summary>Step history</summary>
                    <ol>
                      {g.history.map((h, i) => (
                        <li key={i}>
                          <code>{h.tool}</code> · {h.outcome}
                          <MinecraftDiagnostics entries={h.diagnostics} />
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
              </li>
            ))}
        </ol>
      ) : (
        <div className="integration-empty compact">
          <Flag size={20} />
          <div>
            <h4>Something to work toward</h4>
            <p>Try “Make a stone pickaxe” or “Gather 16 oak logs.”</p>
          </div>
        </div>
      )}
      <details className="integration-disclosure">
        <summary>New inventory goal</summary>
        <p>
          For building or travel goals, ask Eva in chat. This form verifies a
          target item count in her inventory.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await bridge.submitGameGoal({
                objective: objective || `Obtain ${count} ${item}`,
                completion: [{ kind: "inventory", item, count }],
                mode,
                ...(due && data?.goalConfig?.scheduled
                  ? { dueAt: new Date(due).toISOString() }
                  : {}),
              });
              setObjective("");
              setDue("");
            });
          }}
        >
          <fieldset disabled={busy}>
            <div className="form-grid">
              <label className="field">
                <span>Goal description (optional)</span>
                <input
                  value={objective}
                  maxLength={600}
                  onChange={(e) => setObjective(e.target.value)}
                />
              </label>
              <label className="field">
                <span>Target item ID</span>
                <input
                  required
                  value={item}
                  pattern="[a-z0-9_]+"
                  maxLength={100}
                  onChange={(e) => setItem(e.target.value)}
                />
              </label>
              <label className="field">
                <span>Target quantity</span>
                <input
                  type="number"
                  min={1}
                  max={4096}
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                />
              </label>
              <label className="field">
                <span>When another goal exists</span>
                <select value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="queue">Queue after it</option>
                  <option value="replace">Replace existing goals</option>
                </select>
              </label>
              <label className="field">
                <span>Scheduled start (optional)</span>
                <input
                  type="datetime-local"
                  disabled={!data?.goalConfig?.scheduled}
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                />
              </label>
            </div>
            <button className="button primary" disabled={!data?.live.connected}>
              Start game goal
            </button>
          </fieldset>
        </form>
      </details>
      <details className="integration-disclosure">
        <summary>Planning budgets & reactions</summary>
        <p>
          Scheduled goals and survival reactions are independent of companion
          Consciousness and work with activity selection off. Gameplay pause,
          Stop and system lock still apply. Survival reacts at idle action
          boundaries: eat when hungry, or return to a tracked preferred player
          after damage. No automatic attack on guessed targets.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(() =>
              bridge.configureGameGoals(gameGoalConfigSchema.parse(config)),
            );
          }}
        >
          <fieldset disabled={busy}>
            <div className="form-grid">
              {(
                [
                  ["maxSteps", "Maximum steps", 1, 64],
                  ["maxRequests", "Maximum planning requests", 1, 100],
                  ["maxMinutes", "Goal time budget (minutes)", 1, 120],
                  ["stepSeconds", "No-progress timeout (seconds)", 10, 300],
                  ["maxCost", "Reported cost budget (USD)", 0, 50],
                  [
                    "reactionCooldownSeconds",
                    "Reaction cooldown (seconds)",
                    30,
                    3600,
                  ],
                ] as const
              ).map(([key, label, min, max]) => (
                <label className="field" key={key}>
                  <span>{label}</span>
                  <input
                    type="number"
                    step={key === "maxCost" ? 0.01 : 1}
                    min={min}
                    max={max}
                    value={config[key]}
                    onChange={(e) =>
                      setConfig({ ...config, [key]: Number(e.target.value) })
                    }
                  />
                </label>
              ))}
            </div>
            {(
              [
                ["scheduled", "Enable scheduled game goals"],
                ["survival", "Enable survival reactions"],
                ["notify", "Announce meaningful goal outcomes"],
              ] as const
            ).map(([key, label]) => (
              <label className="toggle-row" key={key}>
                <span>{label}</span>
                <input
                  type="checkbox"
                  checked={config[key]}
                  onChange={(e) =>
                    setConfig({ ...config, [key]: e.target.checked })
                  }
                />
              </label>
            ))}
            <p>
              The no-progress timer resets on observed travel or completed
              action units, not heartbeats or status text. The overall goal time
              budget and any configured worker job limit remain hard deadlines.
            </p>
            <p>
              Cost is provider-reported, not a guaranteed billing cap. Request,
              step and time limits apply even when cost is unavailable. Saving
              pauses existing goals; resume them explicitly.
            </p>
            <button className="button primary">
              Save game planning settings
            </button>
          </fieldset>
        </form>
      </details>
    </section>
  );
}
