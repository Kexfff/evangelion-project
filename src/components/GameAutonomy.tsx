import { useEffect, useState } from "react";
import { Compass, Pause, Play } from "lucide-react";
import { bridge } from "../bridge";
import {
  gameAutonomyStateSchema,
  gameAutonomyConfigSchema,
  gameUsage,
} from "../shared/game-autonomy";
import type { MinecraftSnapshot } from "../shared/minecraft";

export function GameAutonomy({ data }: { data?: MinecraftSnapshot }) {
  const state = data?.autonomy ?? gameAutonomyStateSchema.parse({});
  const [config, setConfig] = useState(state.config);
  const saved = JSON.stringify(state.config);
  useEffect(() => setConfig(state.config), [saved]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const hour = gameUsage(state);
  const current = data?.goals?.find((g) => g.status === "running");
  const status = state.config.paused
    ? "Paused"
    : !state.config.enabled
      ? "Off"
      : !data?.live.connected
        ? "Awaiting join"
        : current
          ? "Playing"
          : "Thinking & resting";
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update gameplay.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="game-autonomy"
      aria-label="Independent Minecraft autonomy"
    >
      <div className="integration-section-title">
        <Compass size={20} />
        <h3>Independent gameplay</h3>
        <span className="connection-badge">{status}</span>
      </div>
      <p>
        Her own adventures, in your world. Eva chooses a useful intention,
        verifies each step, and keeps going. Companion quiet hours and
        conversation pause do not affect gameplay.
      </p>
      <div className="game-autonomy-intent" role="status">
        <small>CURRENT INTENTION</small>
        <strong>
          {current?.objective ??
            (state.config.paused
              ? "Taking a break"
              : "A little room for adventure")}
        </strong>
        <p>
          {current?.detail ??
            (!data?.live.connected
              ? "Join a world manually. Eva never connects on her own."
              : state.detail)}
        </p>
        {!current &&
          data?.live.connected &&
          state.config.enabled &&
          !state.config.paused &&
          state.nextDecisionAt > Date.now() && (
            <small>
              Next decision no earlier than{" "}
              {new Date(state.nextDecisionAt).toLocaleTimeString()}
            </small>
          )}
      </div>
      <div className="game-autonomy-metrics">
        <div>
          <strong>
            {hour.requests} / {state.config.hourlyRequests}
          </strong>
          <small>Requests · rolling hour</small>
        </div>
        <div>
          <strong>{hour.tokens.toLocaleString()}</strong>
          <small>Reported tokens · rolling hour</small>
        </div>
        <div>
          <strong>${hour.cost.toFixed(4)}</strong>
          <small>Reported cost · rolling hour</small>
        </div>
      </div>
      <div className="button-row">
        <button
          className="button secondary"
          disabled={busy}
          onClick={() =>
            void run(() => bridge.pauseGameAutonomy(!state.config.paused))
          }
        >
          {state.config.paused ? <Play size={14} /> : <Pause size={14} />}
          {state.config.paused ? "Resume gameplay" : "Pause gameplay"}
        </button>
        <small>
          Stop game action cancels goals and pauses new autonomous choices until
          Resume.
        </small>
      </div>
      {error && (
        <p className="error-notice" role="alert">
          {error}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(() =>
            bridge.configureGameAutonomy(
              gameAutonomyConfigSchema.parse(config),
            ),
          );
        }}
      >
        <fieldset disabled={busy}>
          <label className="toggle-row">
            <span>Choose activities autonomously</span>
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) =>
                setConfig({ ...config, enabled: e.target.checked })
              }
            />
          </label>
          <div className="form-grid">
            <label className="field">
              <span>Play style</span>
              <select
                value={config.preference}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    preference: e.target.value as typeof config.preference,
                  })
                }
              >
                <option value="free">Free play</option>
                <option value="help">Stay with & help the player</option>
                <option value="objective">
                  Work toward a standing objective
                </option>
              </select>
            </label>
            <label className="field">
              <span>Decision interval (seconds)</span>
              <input
                type="number"
                min={10}
                max={3600}
                value={config.intervalSeconds}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    intervalSeconds: Number(e.target.value),
                  })
                }
              />
            </label>
          </div>
          <label className="field">
            <span>Standing objective & preferences</span>
            <textarea
              maxLength={1000}
              rows={2}
              placeholder="Help me build a cozy home. Keep some food and wood, then improve your tools."
              value={config.objective}
              onChange={(e) =>
                setConfig({ ...config, objective: e.target.value })
              }
            />
          </label>
          <label className="toggle-row">
            <span>Announce autonomous outcomes</span>
            <input
              type="checkbox"
              checked={config.notify}
              onChange={(e) =>
                setConfig({ ...config, notify: e.target.checked })
              }
            />
          </label>
          <details className="integration-disclosure">
            <summary>Shared game budget</summary>
            <p>
              Selection and goal execution share these limits, including manual
              goals. New goals do not reset usage. Zero stops new planning
              requests. Local survival reactions do not use the LLM.
            </p>
            <div className="form-grid">
              {(
                [
                  ["hourlyRequests", "Requests per rolling hour", 1000],
                  [
                    "hourlyTokens",
                    "Reported tokens per rolling hour",
                    10000000,
                  ],
                  ["hourlyCost", "Reported USD per rolling hour", 100],
                  ["sessionRequests", "Requests per app session", 10000],
                  [
                    "sessionTokens",
                    "Reported tokens per app session",
                    100000000,
                  ],
                  ["sessionCost", "Reported USD per app session", 1000],
                ] as const
              ).map(([key, label, max]) => (
                <label className="field" key={key}>
                  <span>{label}</span>
                  <input
                    type="number"
                    min={0}
                    max={max}
                    step={key.endsWith("Cost") ? 0.01 : 1}
                    value={config[key]}
                    onChange={(e) =>
                      setConfig({ ...config, [key]: Number(e.target.value) })
                    }
                  />
                </label>
              ))}
            </div>
            <p>
              This app session: {state.session.requests} requests ·{" "}
              {state.session.tokens.toLocaleString()} reported tokens · $
              {state.session.cost.toFixed(4)} reported. The rolling hour
              survives restarts. Providers may omit usage; these are not
              guaranteed billing caps. A single response can exceed a
              reported-usage limit.
            </p>
          </details>
          <p className="game-autonomy-note">
            Uses your configured LLM and OpenRouter provider selection. Existing
            tool permissions apply; Ask tools wait for an explicit user
            instruction. Manual goals remain available with activity selection
            off.
          </p>
          <button className="button primary">Save independent gameplay</button>
        </fieldset>
      </form>
      {!!state.memories.length && (
        <details className="integration-disclosure">
          <summary>
            World journal · {state.memories.length} recent outcomes
          </summary>
          <p>
            Timestamped game observations, separate from personal memories.
            Historical resources and coordinates may have changed.
          </p>
          <ol className="minecraft-jobs">
            {[...state.memories]
              .reverse()
              .slice(0, 8)
              .map((m, i) => (
                <li key={`${m.observedAt}-${i}`}>
                  <strong>{m.objective}</strong>
                  <p>{m.outcome}</p>
                  <small>
                    {m.status} · {new Date(m.observedAt).toLocaleString()}
                  </small>
                </li>
              ))}
          </ol>
        </details>
      )}
    </section>
  );
}
