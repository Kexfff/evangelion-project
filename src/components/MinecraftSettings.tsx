import { useEffect, useState } from "react";
import { bridge } from "../bridge";
import {
  minecraftConfigSchema,
  MINECRAFT_ID,
  type MinecraftConfig,
  type MinecraftSnapshot,
} from "../shared/minecraft";
import type { McpSnapshot, ToolPolicy } from "../shared/mcp";

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
      <div className="section-heading">
        <h2>Minecraft companion</h2>
        <p>
          Java 26.1 · bundled Mineflayer adapter · no separate bot or Node
          installation needed.
        </p>
      </div>
      <p>
        {data?.live.status ?? "Not connected"} ·{" "}
        {connection?.status ?? "Save a connection to begin"}
      </p>
      <div className="button-row">
        <button
          className="button primary"
          disabled={
            busy || !connection || connection.config.characterId !== characterId
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
      <details open={!connection}>
        <summary>World connection and safety limits</summary>
        <p>
          Normal companion movement has no leash or timer. Block changes and
          public chat remain separate choices.
        </p>
        <button
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
              "Companion movement selected. Save Minecraft configuration, then reconnect. Block/chat permissions were not changed.",
            );
          }}
        >
          Use companion movement defaults
        </button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () =>
                bridge.configureMinecraft(
                  minecraftConfigSchema.parse({ ...config, characterId }),
                ),
              "Saved disabled. Join world, then grant tools below. Existing grants were reset.",
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
              {(
                [
                  ["port", "Minecraft port", 1, 65535],
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
                  "movement",
                  "Allow movement (never digs or places while navigating)",
                ],
                ["chat", "Allow public Minecraft chat"],
                ["modifyBlocks", "Allow block changes inside the build area"],
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
            {config.modifyBlocks && (
              <>
                <p>
                  Block changes can permanently alter your world. Back it up and
                  designate a disposable area first. Tool grants are still
                  required.
                </p>
                <div className="form-grid">
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
                    <span>Build radius</span>
                    <input
                      type="number"
                      min={1}
                      max={16}
                      value={config.buildRadius}
                      onChange={(e) =>
                        set("buildRadius", Number(e.target.value))
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Maximum blocks per job</span>
                    <input
                      type="number"
                      min={1}
                      max={64}
                      value={config.maxBlocks}
                      onChange={(e) => set("maxBlocks", Number(e.target.value))}
                    />
                  </label>
                </div>
              </>
            )}
            <p>
              This save disconnects the bot and resets grants; it does not join
              the world. Assigned character: {characterId}. Use this button, not
              the page’s Save changes.
            </p>
            <button className="button primary" type="submit">
              Save Minecraft configuration
            </button>
          </fieldset>
        </form>
      </details>
      {!!connection?.tools.length && (
        <>
          <h3>Minecraft tool permissions</h3>
          <p>
            Enable everyday controls once to let her look around, walk and
            follow without approval popups. Block changes and public chat keep
            their separate permissions. Optional per-tool controls are below.
          </p>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                for (const t of connection.tools.filter((t) =>
                  [
                    "observe",
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
          <details>
            <summary>Individual tool permissions</summary>
            {connection.tools.map((t) => (
              <label className="field" key={t.name}>
                <span>{t.name}</span>
                <select
                  aria-label={`Minecraft permission for ${t.name}`}
                  value={t.policy}
                  disabled={busy}
                  onChange={(e) => {
                    const policy = e.target.value as ToolPolicy;
                    if (
                      policy === "allow" &&
                      !["observe", "job_status", "stop_action"].includes(
                        t.name,
                      ) &&
                      !window.confirm(
                        `Allow ${t.name} without confirmation? It can act in your Minecraft world within the configured limits.`,
                      )
                    )
                      return;
                    void run(() =>
                      bridge.mcpGrant(
                        MINECRAFT_ID,
                        t.name,
                        t.fingerprint,
                        policy,
                      ),
                    );
                  }}
                >
                  <option value="deny">Blocked</option>
                  <option value="ask">Ask every time</option>
                  <option value="allow">Allow without asking</option>
                </select>
              </label>
            ))}
          </details>
        </>
      )}
      {data?.live.connected && (
        <div className="mcp-connection">
          <h3>In the world</h3>
          <p>
            Health {data.live.health} · Food {data.live.food} ·{" "}
            {data.live.dimension}
          </p>
          <p>
            Position:{" "}
            {data.live.position &&
              [data.live.position.x, data.live.position.y, data.live.position.z]
                .map((n) => n.toFixed(1))
                .join(", ")}
          </p>
          <p>Players: {data.live.players.join(", ") || "None nearby"}</p>
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
      <h3>Game jobs</h3>
      <p>
        Jobs continue locally while you chat. Only one job owns movement; stop
        it before giving a conflicting instruction. Disconnect,
        character/settings changes and restart never replay a job.
      </p>
      {data?.jobs.length ? (
        <ol className="minecraft-jobs">
          {data.jobs.slice(0, 10).map((savedJob) => {
            const j =
              data.live.job?.id === savedJob.id ? data.live.job : savedJob;
            return (
              <li key={j.id}>
                <strong>
                  {j.kind} · {j.status}
                </strong>{" "}
                {j.total > 0 && (
                  <>
                    · {j.progress}/{j.total}
                  </>
                )}
                <p>{j.detail}</p>
                <small>
                  {j.worldId} · {new Date(j.updatedAt).toLocaleString()}
                </small>
              </li>
            );
          })}
        </ol>
      ) : (
        <p>No game jobs yet.</p>
      )}
      <details>
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
