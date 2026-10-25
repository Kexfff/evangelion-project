import { useEffect, useState } from "react";
import {
  Cable,
  Compass,
  Flag,
  Gamepad2,
  Heart,
  MapPin,
  Wheat,
  ShieldCheck,
  Activity,
} from "lucide-react";
import { ToolPermissions } from "./ToolPermissions";
import { GameGoals } from "./GameGoals";
import { GameProjects } from "./GameProjects";
import { MinecraftDiagnostics } from "./MinecraftDiagnostics";
import { GameAutonomy } from "./GameAutonomy";
import { bridge } from "../bridge";
import {
  minecraftConfigSchema,
  MINECRAFT_ID,
  type MinecraftConfig,
  type MinecraftSnapshot,
} from "../shared/minecraft";
import type { McpSnapshot } from "../shared/mcp";

type MinecraftTab =
  "play" | "goals" | "autonomy" | "permissions" | "connection";
const minecraftTabs: {
  id: MinecraftTab;
  label: string;
  icon: typeof Gamepad2;
}[] = [
  { id: "play", label: "Play", icon: Activity },
  { id: "goals", label: "Goals & projects", icon: Flag },
  { id: "autonomy", label: "On her own", icon: Compass },
  { id: "permissions", label: "Permissions", icon: ShieldCheck },
  { id: "connection", label: "Connection", icon: Cable },
];

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
  // Start on Connection until one is saved; after that, on what she's doing.
  const [tab, setTab] = useState<MinecraftTab>(
    connection ? "play" : "connection",
  );
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
  const status = !enabled
    ? "Plugin off"
    : data?.live.connected
      ? `In ${data.live.dimension}`
      : connection
        ? "Offline"
        : "Not set up";
  return (
    <section className="card plugin-settings minecraft-settings">
      <div className="section-heading integration-panel-heading">
        <span className="integration-icon minecraft">
          <Gamepad2 size={22} />
        </span>
        <div>
          <h2>Minecraft companion</h2>
          <p>
            Play Java 26.1 worlds together. Everything she needs is built in.
          </p>
        </div>
        <span
          className={`connection-badge ${data?.live.connected ? "online" : ""}`}
        >
          {status}
        </span>
      </div>
      <div className="minecraft-controls">
        <label className="toggle-row">
          <div>
            <span>Enable Minecraft plugin</span>
            <small id="minecraft-enable-hint">
              Applies right away. Turning it off stops gameplay; the app never
              joins a world on its own.
            </small>
          </div>
          <input
            type="checkbox"
            aria-label="Enable Minecraft plugin"
            aria-describedby="minecraft-enable-hint"
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
            Visit microsoft.com/link and enter{" "}
            <code>{data.live.loginCode}</code>. This code is temporary; sign-in
            is session-only.
          </p>
        )}
      </div>
      <div
        className="minecraft-tabs"
        role="group"
        aria-label="Minecraft sections"
      >
        {minecraftTabs.map(({ id, label, icon: Icon }) => (
          <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>
      <div className="minecraft-panel" hidden={tab !== "play"}>
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
                [
                  data.live.position.x,
                  data.live.position.y,
                  data.live.position.z,
                ]
                  .map((n) => n.toFixed(1))
                  .join(", ")}
            </p>
            <p>Players: {data.live.players.join(", ") || "None nearby"}</p>
            <details>
              <summary>Player coordinates</summary>
              <p className="minecraft-help">
                Minecraft only shares nearby players’ positions, so these can be
                out of date. With operator lookup on, ask her to find a player
                for a fresh position.
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
        {!data?.live.connected && (
          <div className="integration-empty compact">
            <MapPin size={20} />
            <div>
              <h4>Not in a world right now.</h4>
              <p>
                {connection
                  ? "Choose Join world to see her health, food, position and inventory here."
                  : "Set up the connection first, then join a world."}
              </p>
            </div>
          </div>
        )}
        <div className="integration-section-title">
          <Activity size={17} />
          <h3>Game jobs</h3>
        </div>
        <p className="minecraft-help">
          What she’s doing in the game. Jobs keep running while you chat; a new
          one replaces the current one, and Stop game action cancels it. Jobs
          never restart on their own after a disconnect or restart.
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
                  {j.lastProgressAt && (
                    <small>
                      Last observed progress:{" "}
                      {j.progressDetail ?? "Action progress"} ·{" "}
                      {new Date(j.lastProgressAt).toLocaleTimeString()}
                    </small>
                  )}
                  <MinecraftDiagnostics entries={j.diagnostics} />
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
        <div className="integration-section-title">
          <MapPin size={17} />
          <h3>World landmarks</h3>
        </div>
        <p className="minecraft-help">
          Places she can find again, kept per world and dimension — separate
          from her memories about you.
        </p>
        <form
          className="minecraft-landmark-form"
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
      </div>
      <div className="minecraft-panel" hidden={tab !== "goals"}>
        <fieldset disabled={!enabled} className="minecraft-goal-controls">
          <GameGoals data={data} />
          <GameProjects data={data} />
        </fieldset>
      </div>
      <div className="minecraft-panel" hidden={tab !== "autonomy"}>
        <fieldset disabled={!enabled} className="minecraft-goal-controls">
          <GameAutonomy data={data} />
        </fieldset>
      </div>
      <div className="minecraft-panel" hidden={tab !== "permissions"}>
        {!!connection?.tools.length && (
          <>
            <div className="integration-section-title">
              <ShieldCheck size={17} />
              <h3>Minecraft tool permissions</h3>
              <span className="connection-badge online">Allow by default</span>
            </div>
            <p className="minecraft-help">
              Everything is allowed unless you block it, and changes apply right
              away. Blocking a tool that edits or uses blocks also stops her
              digging or building her way around while walking. (Other MCP tools
              start blocked instead.)
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
                    bridge.mcpGrant(
                      MINECRAFT_ID,
                      t.name,
                      t.fingerprint,
                      policy,
                    ),
                  )
                }
              />
            </details>
          </>
        )}
        {!connection?.tools.length && (
          <div className="integration-empty compact">
            <ShieldCheck size={20} />
            <div>
              <h4>Her tools appear after the first join.</h4>
              <p>
                Join a world once to choose which Minecraft actions she may use.
                Everything is allowed by default.
              </p>
            </div>
          </div>
        )}
      </div>
      <div className="minecraft-panel" hidden={tab !== "connection"}>
        <p className="minecraft-help">
          Minecraft actions are allowed by default. She can roam and change
          terrain freely; to rule something out, block it under Permissions or
          set limits below.
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
            <p className="minecraft-help">
              LAN ports can change each time you reopen a world. Give each world
              its own label so its landmarks stay separate. Microsoft sign-in
              needs an account that owns Minecraft; it stays in memory only.
            </p>
            <label className="toggle-row">
              <div>
                <span>Operator coordinate lookup</span>
                <small id="operator-lookup-hint">
                  Lets her ask the server where a player is, even out of sight
                  (read-only). Needs cheats or operator permission in that
                  world; she can’t grant it to herself.
                </small>
              </div>
              <input
                type="checkbox"
                aria-label="Operator coordinate lookup"
                aria-describedby="operator-lookup-hint"
                checked={config.operatorLookup}
                onChange={(e) => set("operatorLookup", e.target.checked)}
              />
            </label>
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
              <p className="minecraft-help">
                Block changes can permanently alter your world. These limits
                apply only if you set them, and 0 means no limit. To stop
                terrain edits entirely, block collect_blocks, build_blocks,
                dig_block and interact_block under Permissions.
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
            <p className="minecraft-help">
              Saving disconnects her from the world but keeps your tool choices;
              use Join world afterwards. This form has its own Save button — the
              page’s Save changes doesn’t apply here. Assigned character:{" "}
              {characterId}.
            </p>
            <button className="button primary" type="submit">
              Save Minecraft configuration
            </button>
          </fieldset>
        </form>
      </div>
    </section>
  );
}
