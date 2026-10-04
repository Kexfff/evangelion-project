import { useEffect, useState } from "react";
import {
  Gamepad2,
  Heart,
  MapPin,
  Wheat,
  ShieldCheck,
  Activity,
} from "lucide-react";
import { ToolPermissions } from "./ToolPermissions";
import { GameGoals } from "./GameGoals";
import { bridge } from "../bridge";
import {
  minecraftConfigSchema,
  MINECRAFT_ID,
  type MinecraftConfig,
  type MinecraftSnapshot,
} from "../shared/minecraft";
import type { McpSnapshot } from "../shared/mcp";

export function MinecraftSettings({
  data,
  mcp,
  characterId,
}: {
  data?: MinecraftSnapshot;
  mcp?: McpSnapshot;
  characterId: string;
}) {
  const [config, setConfig] = useState(
    data?.config ?? minecraftConfigSchema.parse({}),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [landmark, setLandmark] = useState("");
  const saved = JSON.stringify(data?.config);
  useEffect(() => {
    setConfig(data?.config ?? minecraftConfigSchema.parse({}));
  }, [saved]);
  const connection = mcp?.servers.find((s) => s.config.id === MINECRAFT_ID);
  const enabled = data?.enabled !== false;
  const set = <K extends keyof MinecraftConfig>(
    key: K,
    value: MinecraftConfig[K],
  ) => setConfig((c) => ({ ...c, [key]: value }));
  async function run(
    work: () => Promise<unknown>,
    message = "Minecraft updated.",
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      setNotice(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Minecraft operation failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card plugin-settings minecraft-settings">
      <div className="section-heading integration-panel-heading">
        <span className="integration-icon minecraft">
          <Gamepad2 size={22} />
        </span>
        <div>
          <h2>Minecraft companion</h2>
          <p>
            Java 26.1 · bundled Mineflayer adapter · no separate bot or Node
            installation needed.
          </p>
        </div>
        <span
          className={`connection-badge ${data?.live.connected ? "online" : ""}`}
        >
          {!enabled
            ? "Plugin off"
            : data?.live.connected
              ? "Connected"
              : "Offline"}
        </span>
      </div>
      <label className="toggle-row">
        <span>Enable Minecraft plugin</span>
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy}
          onChange={(e) => {
            const next = e.target.checked;
            void run(
              () => bridge.setMinecraftEnabled(next),
              next
                ? "Minecraft enabled. Choose Join world when ready."
                : "Minecraft is off. Gameplay stopped; connection settings, tool choices and history were kept.",
            );
          }}
        />
      </label>
      <p className="connection-status-line">
        Applies immediately. Turning off stops gameplay and removes Minecraft
        tools. Enabling or restarting the app never joins a world automatically.
      </p>
      <p className="connection-status-line">
        {data?.live.status ?? "Not connected"} ·{" "}
        {connection?.status ?? "Save a connection to begin"}
      </p>
      <div className="button-row">
        <button
          className="button primary"
          disabled={
            busy ||
            !enabled ||
            !connection ||
            connection.config.characterId !== characterId
          }
          onClick={() =>
            void run(
              () => bridge.minecraftAction("connect"),
              "Connection requested. Check world status above.",
            )
          }
        >
          Join world
        </button>
        <button
          className="button secondary"
          disabled={busy || !connection}
          onClick={() => void run(() => bridge.minecraftAction("disconnect"))}
        >
          Leave world
        </button>
        <button
          className="button secondary"
          onClick={() =>
            void run(
              () => bridge.minecraftAction("stop"),
              "Stop requested; completed block changes cannot be undone.",
            )
          }
        >
          Stop game action
        </button>
      </div>
      {error && (
        <p className="error-notice" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="success-notice" role="status">
          {notice}
        </p>
      )}
      {data?.live.loginCode && (
        <p role="status">
          Visit microsoft.com/link and enter <code>{data.live.loginCode}</code>.
          This code is temporary; sign-in is session-only.
        </p>
      )}
      <fieldset disabled={!enabled} className="minecraft-goal-controls">
        <GameGoals data={data} />
      </fieldset>
      <details className="integration-disclosure" open={!connection}>
        <summary>World connection and optional limits</summary>
        <p>
          Minecraft actions are allowed by default. Block an action below if you
          don’t want Eva to do it. There is no separate block-edit or chat
          switch. By default, she can roam and change terrain without a leash or
          timer.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () =>
                bridge.configureMinecraft(
                  minecraftConfigSchema.parse({ ...config, characterId }),
                ),
              "Saved. Join world to play. Minecraft actions default to Allow; your explicit tool choices were preserved.",
            );
          }}
        >
          <fieldset disabled={busy}>
            <legend>Connection</legend>
            <div className="form-grid">
              {(
                [
                  ["host", "Minecraft host"],
                  ["username", "Bot name / account"],
                  ["worldId", "World label"],
                  ["trustedPlayer", "Preferred player (optional)"],
                ] as const
              ).map(([key, label]) => (
                <label className="field" key={key}>
                  <span>{label}</span>
                  <input
                    value={config[key]}
                    onChange={(e) => set(key, e.target.value)}
                  />
                </label>
              ))}
              <label className="field">
                <span>Minecraft authentication</span>
                <select
                  value={config.auth}
                  onChange={(e) =>
                    set("auth", e.target.value as MinecraftConfig["auth"])
                  }
                >
                  <option value="offline">LAN / offline identity</option>
                  <option value="microsoft">
                    Microsoft sign-in (session only)
                  </option>
                </select>
              </label>
              <label className="field">
                <span>Allowed dimension</span>
                <select
                  value={config.dimension}
                  onChange={(e) =>
                    set(
                      "dimension",
                      e.target.value as MinecraftConfig["dimension"],
                    )
                  }
                >
                  <option value="overworld">Overworld</option>
                  <option value="the_nether">Nether</option>
                  <option value="the_end">End</option>
                </select>
              </label>
              {([["port", "Minecraft port", 1, 65535]] as const).map(
                ([key, label, min, max]) => (
                  <label className="field" key={key}>
                    <span>{label}</span>
                    <input
                      type="number"
                      min={min}
                      max={max}
                      value={config[key]}
                      onChange={(e) => set(key, Number(e.target.value))}
                    />
                  </label>
                ),
              )}
            </div>
            <p>
              LAN ports may change when reopening a world. Use a distinct world
              label for its landmarks. Microsoft sign-in needs a
              Minecraft-owning account; tokens remain in memory, not your
              .minecraft folder.
            </p>
            {(
              [
                [
                  "operatorLookup",
                  "Operator coordinate lookup (requires cheats / operator permission)",
                ],
              ] as const
            ).map(([key, label]) => (
              <label className="toggle-row" key={key}>
                <span>{label}</span>
                <input
                  type="checkbox"
                  checked={config[key]}
                  onChange={(e) => set(key, e.target.checked)}
                />
              </label>
            ))}
            <p>
              Operator lookup uses only read-only /data queries for player
              position and dimension, even beyond tracking range. It cannot
              grant itself operator permission. This is not an autonomous game
              planner or arbitrary command execution.
            </p>
            <details className="integration-disclosure">
              <summary>Optional gameplay limits</summary>
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  setConfig((c) => ({
                    ...c,
                    movement: true,
                    radius: 0,
                    jobSeconds: 0,
                  }));
                  setNotice(
                    "Movement limits cleared. Save and reconnect. Explicit tool blocks are unchanged.",
                  );
                }}
              >
                Use companion movement defaults
              </button>
              <p>
                Block changes can permanently alter your world. Optional limits
                below apply only if you set them; radius 0 means anywhere. Block
                collect_blocks, build_blocks, dig_block and interact_block below
                to disable direct terrain edits and block activation, as well as
                edits while navigating.
              </p>
              <div className="form-grid">
                {(
                  [
                    ["radius", "Movement radius (0 = no leash)", 0, 30000000],
                    [
                      "jobSeconds",
                      "Job timeout seconds (0 = until stopped)",
                      0,
                      86400,
                    ],
                  ] as const
                ).map(([key, label, min, max]) => (
                  <label className="field" key={key}>
                    <span>{label}</span>
                    <input
                      type="number"
                      min={min}
                      max={max}
                      value={config[key]}
                      onChange={(e) => set(key, Number(e.target.value))}
                    />
                  </label>
                ))}
                {(["x", "y", "z"] as const).map((axis) => (
                  <label className="field" key={axis}>
                    <span>Build center {axis.toUpperCase()}</span>
                    <input
                      type="number"
                      value={config.buildCenter[axis]}
                      onChange={(e) =>
                        set("buildCenter", {
                          ...config.buildCenter,
                          [axis]: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                ))}
                <label className="field">
                  <span>Build radius (0 = anywhere)</span>
                  <input
                    type="number"
                    min={0}
                    max={30000000}
                    value={config.buildRadius}
                    onChange={(e) => set("buildRadius", Number(e.target.value))}
                  />
                </label>
                <label className="field">
                  <span>Maximum blocks per job</span>
                  <input
                    type="number"
                    min={1}
                    max={1024}
                    value={config.maxBlocks}
                    onChange={(e) => set("maxBlocks", Number(e.target.value))}
                  />
                </label>
              </div>
            </details>
            <p>
              This save disconnects the bot but preserves tool choices; it does
              not join the world. Assigned character: {characterId}. Use this
              button, not the page’s Save changes.
            </p>
            <button className="button primary" type="submit">
              Save Minecraft configuration
            </button>
          </fieldset>
        </form>
      </details>
      {!!connection?.tools.length && (
        <>
          <div className="integration-section-title">
            <ShieldCheck size={17} />
            <h3>Minecraft tool permissions</h3>
            <span className="connection-badge online">Allow by default</span>
          </div>
          <p>
            Allowed unless blocked. These are the only Minecraft action
            permissions; changes apply immediately. Blocking a block-edit or
            block-interaction tool also disables automatic digging and
            scaffolding while navigating. Other MCP servers still default to
            Blocked.
          </p>
          <div className="button-row">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  for (const t of connection.tools.filter((t) =>
                    [
                      "observe",
                      "locate_player",
                      "move_to",
                      "follow_player",
                      "job_status",
                      "stop_action",
                    ].includes(t.name),
                  ))
                    await bridge.mcpGrant(
                      MINECRAFT_ID,
                      t.name,
                      t.fingerprint,
                      "allow",
                    );
                }, "Everyday controls enabled. Block changes and public chat permissions are unchanged.")
              }
            >
              Enable everyday controls
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => {
                if (
                  !window.confirm(
                    "Clear explicit blocks and allow all supported Minecraft actions, including terrain changes and requested public game chat?",
                  )
                )
                  return;
                void run(async () => {
                  for (const t of connection.tools)
                    await bridge.mcpGrant(
                      MINECRAFT_ID,
                      t.name,
                      t.fingerprint,
                      "allow",
                    );
                }, "All Minecraft actions allowed. No separate block/chat switches are needed. Operator lookup remains a server-permission-dependent option.");
              }}
            >
              Enable all game tools
            </button>
          </div>
          <details className="integration-disclosure">
            <summary>Individual tool permissions</summary>
            <ToolPermissions
              tools={connection.tools}
              scope="Minecraft"
              minecraft
              disabled={busy}
              onChange={(t, policy) =>
                void run(() =>
                  bridge.mcpGrant(MINECRAFT_ID, t.name, t.fingerprint, policy),
                )
              }
            />
          </details>
        </>
      )}
      {data?.live.connected && (
        <div className="minecraft-world-card">
          <div className="integration-section-title">
            <MapPin size={17} />
            <h3>In the world</h3>
            <span className="connection-badge">{data.live.dimension}</span>
          </div>
          <div className="minecraft-vitals">
            <span>
              <Heart size={16} /> Health{" "}
              <strong>{data.live.health} / 20</strong>
            </span>
            <span>
              <Wheat size={16} /> Food <strong>{data.live.food} / 20</strong>
            </span>
          </div>
          <p>
            Position:{" "}
            {data.live.position &&
              [data.live.position.x, data.live.position.y, data.live.position.z]
                .map((n) => n.toFixed(1))
                .join(", ")}
          </p>
          <p>Players: {data.live.players.join(", ") || "None nearby"}</p>
          <details>
            <summary>Player coordinates</summary>
            <p>
              Tracking range is controlled by Minecraft. Last-seen positions are
              stale, not live coordinates. Ask Eva to locate a player to query
              the server when operator lookup is enabled.
            </p>
            <ul>
              {data.live.playerLocations?.map((p) => (
                <li key={p.name}>
                  {p.name} · {p.source}{" "}
                  {p.position &&
                    `· ${p.position.x.toFixed(1)}, ${p.position.y.toFixed(1)}, ${p.position.z.toFixed(1)} · ${p.dimension}`}{" "}
                  {p.observedAt &&
                    `· observed ${new Date(p.observedAt).toLocaleTimeString()}`}{" "}
                  {p.reason}
                </li>
              ))}
            </ul>
          </details>
          <details>
            <summary>Inventory · {data.live.inventory.length} stacks</summary>
            <ul>
              {data.live.inventory.map((i, n) => (
                <li key={n}>
                  {i.name} × {i.count}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
      <div className="integration-section-title">
        <Activity size={17} />
        <h3>Game jobs</h3>
      </div>
      <p>
        Actions continue locally while you chat. A new action replaces the
        previous one after its cleanup finishes; Stop cancels it. Disconnect,
        character/settings changes and restart never replay a job.
      </p>
      {data?.jobs.length ? (
        <ol className="minecraft-jobs">
          {data.jobs.slice(0, 10).map((savedJob) => {
            const j =
              data.live.job?.id === savedJob.id ? data.live.job : savedJob;
            return (
              <li key={j.id} data-status={j.status}>
                <strong>
                  {j.kind} · {j.status}
                </strong>{" "}
                {j.total > 0 && (
                  <>
                    · {j.progress}/{j.total}
                  </>
                )}
                <p>{j.detail}</p>
                {j.result && (
                  <details>
                    <summary>Action result</summary>
                    <pre
                      style={{
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {JSON.stringify(j.result, null, 2)}
                    </pre>
                  </details>
                )}
                <small>
                  {j.worldId} · {new Date(j.updatedAt).toLocaleString()}
                </small>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="integration-empty compact">
          <Activity size={20} />
          <div>
            <h4>No game jobs yet.</h4>
            <p>Ask Eva to follow you, craft something or explore together.</p>
          </div>
        </div>
      )}
      <details className="integration-disclosure">
        <summary>World landmarks</summary>
        <p>
          Scoped to character, world label, endpoint and dimension—not mixed
          into personal facts.
        </p>
        <form
          className="button-row"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await bridge.saveLandmark(landmark);
              setLandmark("");
            });
          }}
        >
          <input
            aria-label="Landmark name"
            placeholder="Our base"
            value={landmark}
            maxLength={80}
            onChange={(e) => setLandmark(e.target.value)}
          />
          <button
            className="button secondary"
            disabled={!data?.live.connected || busy || !landmark.trim()}
          >
            Remember current location
          </button>
        </form>
        <ul>
          {data?.landmarks.map((l) => (
            <li key={l.id}>
              {l.name} · {l.worldId} · {l.dimension} · {l.position.x.toFixed(0)}
              , {l.position.y.toFixed(0)}, {l.position.z.toFixed(0)}{" "}
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void run(() => bridge.deleteLandmark(l.id))}
              >
                Delete {l.name}
              </button>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
