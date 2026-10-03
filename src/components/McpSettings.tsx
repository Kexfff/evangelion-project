import { useState } from "react";
import {
  Cable,
  Plus,
  ShieldCheck,
  Server,
  Globe,
  KeyRound,
} from "lucide-react";
import { ToolPermissions } from "./ToolPermissions";
import { bridge } from "../bridge";
import { MINECRAFT_ID } from "../shared/minecraft";
import {
  mcpConfigSchema,
  mcpSecretsSchema,
  type McpConfig,
  type McpSnapshot,
} from "../shared/mcp";

export function McpSettings({
  data,
  characterId,
}: {
  data?: McpSnapshot;
  characterId: string;
}) {
  data = data && {
    ...data,
    servers: data.servers.filter((s) => s.config.id !== MINECRAFT_ID),
  };
  const [draft, setDraft] = useState<McpConfig>();
  const [editing, setEditing] = useState(false);
  const [args, setArgs] = useState("[]");
  const [token, setToken] = useState("");
  const [env, setEnv] = useState("");
  const [replaceSecrets, setReplaceSecrets] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function run(
    work: () => Promise<unknown>,
    message = "MCP settings updated.",
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      setNotice(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "MCP operation failed.");
    } finally {
      setBusy(false);
    }
  }
  function edit(config?: McpConfig) {
    setEditing(!!config);
    setDraft(
      config ?? {
        id: "",
        name: "",
        transport: "stdio",
        command: "",
        args: [],
        url: "",
        enabled: false,
        characterId,
      },
    );
    setArgs(JSON.stringify(config?.args ?? []));
    setToken("");
    setEnv("");
    setReplaceSecrets(!config);
    setError("");
  }
  return (
    <section className="card plugin-settings mcp-settings">
      <div className="section-heading integration-panel-heading">
        <span className="integration-icon mcp">
          <Cable size={22} />
        </span>
        <div>
          <h2>MCP connections</h2>
          <p>
            Give your companion new tools, one permission at a time. Changes
            apply immediately.
          </p>
        </div>
        <span className="connection-badge">
          {data?.servers.length ?? 0} configured
        </span>
      </div>
      <div className="integration-trust-note">
        <ShieldCheck size={17} />
        <p>
          Local servers run with your OS account’s access, not in a sandbox.
          Remote servers receive tool arguments. Only connect servers you trust.
        </p>
      </div>
      <div className="button-row">
        <button
          className="button primary"
          disabled={busy}
          onClick={() => edit()}
        >
          <Plus size={15} />
          Add MCP connection
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
      {!!data?.pending.length && (
        <div className="mcp-approvals integration-approval-panel">
          <h3>Waiting for your approval</h3>
          <p>
            Review the exact arguments below. Approval is for this call only and
            expires after 60 seconds.
          </p>
          {data.pending.map((p) => (
            <article key={p.id} className="mcp-connection">
              <h4>
                {p.serverId} / {p.tool}
              </h4>
              <p>
                Requested from {p.channel}. Arguments may contain private
                information.
              </p>
              <pre>{p.arguments}</pre>
              <div className="button-row">
                <button
                  className="button primary"
                  onClick={() =>
                    void run(
                      () => bridge.mcpApproval(p.id, true),
                      "Approved once.",
                    )
                  }
                >
                  Approve once
                </button>
                <button
                  className="button secondary"
                  onClick={() =>
                    void run(
                      () => bridge.mcpApproval(p.id, false),
                      "Tool call denied.",
                    )
                  }
                >
                  Deny
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {draft && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const config = mcpConfigSchema.parse({
                ...draft,
                args: JSON.parse(args),
              });
              if (
                !editing &&
                data?.servers.some((s) => s.config.id === config.id)
              )
                throw new Error(
                  "This connection ID already exists. Edit the existing connection instead.",
                );
              const secrets = replaceSecrets
                ? mcpSecretsSchema.parse({
                    token,
                    env: JSON.parse(env || "{}"),
                  })
                : undefined;
              await bridge.configureMcp(config, secrets);
              setDraft(undefined);
              setToken("");
              setEnv("");
            }, "Connection saved disabled. Connect to review trust and discover tools.");
          }}
        >
          <fieldset disabled={busy}>
            <legend>{editing ? "Edit connection" : "New connection"}</legend>
            <div className="form-grid">
              <label className="field">
                <span>Connection ID</span>
                <input
                  value={draft.id}
                  disabled={editing}
                  placeholder="my-tools"
                  maxLength={32}
                  required
                  onChange={(e) => setDraft({ ...draft, id: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Connection name</span>
                <input
                  autoFocus
                  value={draft.name}
                  maxLength={60}
                  required
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Transport</span>
                <select
                  value={draft.transport}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      transport: e.target.value as McpConfig["transport"],
                    })
                  }
                >
                  <option value="stdio">Local program (stdio)</option>
                  <option value="http">
                    Remote endpoint (Streamable HTTP)
                  </option>
                </select>
              </label>
            </div>
            <p>
              Character: {draft.characterId}. Only this character can use these
              tools.
            </p>
            {draft.transport === "stdio" ? (
              <>
                <label className="field">
                  <span>Executable</span>
                  <input
                    value={draft.command}
                    placeholder="/absolute/path/to/server"
                    required
                    onChange={(e) =>
                      setDraft({ ...draft, command: e.target.value })
                    }
                  />
                </label>
                <label className="field">
                  <span>Arguments (JSON array)</span>
                  <textarea
                    value={args}
                    rows={3}
                    onChange={(e) => setArgs(e.target.value)}
                  />
                </label>
                <p>
                  No shell expansion. External servers need their own installed
                  executable/runtime. Do not put secrets in arguments; use the
                  vault-backed environment below.
                </p>
              </>
            ) : (
              <label className="field">
                <span>MCP endpoint</span>
                <input
                  type="url"
                  value={draft.url}
                  placeholder="https://example.com/mcp"
                  required
                  onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                />
                <small>
                  HTTPS, or HTTP on localhost. No redirects, URL credentials,
                  query parameters, or OAuth sign-in in this release.
                </small>
              </label>
            )}
            <label className="toggle-row">
              <span>Replace saved credentials (empty values clear them)</span>
              <input
                type="checkbox"
                checked={replaceSecrets}
                onChange={(e) => setReplaceSecrets(e.target.checked)}
              />
            </label>
            {replaceSecrets &&
              (draft.transport === "http" ? (
                <label className="field">
                  <span>Bearer token</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                  />
                </label>
              ) : (
                <label className="field">
                  <span>Environment variables (secret JSON object)</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    placeholder='{"API_KEY":"…"}'
                    value={env}
                    onChange={(e) => setEnv(e.target.value)}
                  />
                </label>
              ))}
            <p>
              Credentials stay in the existing vault and are never returned to
              the UI. Saving disconnects the server and resets all tool grants.
            </p>
            <div className="button-row">
              <button className="button primary" type="submit">
                Save connection
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() => {
                  setDraft(undefined);
                  setToken("");
                  setEnv("");
                }}
              >
                Cancel editing
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {!data?.servers.length && !draft && (
        <div className="integration-empty">
          <Cable size={30} />
          <h3>Your next connection starts here</h3>
          <p>
            No connections yet. Add a trusted MCP server, then choose which
            tools your companion may use.
          </p>
          <span className="connection-badge">
            Local programs · Remote services
          </span>
        </div>
      )}
      {data?.servers.map((s) => (
        <article key={s.config.id} className="mcp-connection">
          <div className="section-heading integration-panel-heading">
            <span className="integration-icon mcp">
              {s.config.transport === "stdio" ? (
                <Server size={20} />
              ) : (
                <Globe size={20} />
              )}
            </span>
            <div>
              <h3>{s.config.name}</h3>
              <p>
                {s.status} ·{" "}
                {s.config.transport === "stdio"
                  ? "Local program"
                  : "Streamable HTTP"}{" "}
                · character {s.config.characterId}
              </p>
            </div>
            <span
              className={`connection-badge ${s.status === "Connected" ? "online" : ""}`}
            >
              {s.status}
            </span>
          </div>
          <div className="connection-meta">
            <span>
              {s.tools.length} tool{s.tools.length === 1 ? "" : "s"} discovered
            </span>
            <span>
              <KeyRound size={12} />
              {s.hasSecrets ? "Credentials saved" : "No saved credentials"}
            </span>
          </div>
          <div className="button-row">
            <button
              className="button secondary"
              disabled={busy || s.config.characterId !== characterId}
              onClick={() =>
                void run(
                  () => bridge.mcpAction(s.config.id, "connect"),
                  "Connection request finished. Check its status below.",
                )
              }
            >
              Connect / reconnect
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                void run(() => bridge.mcpAction(s.config.id, "disconnect"))
              }
            >
              Disconnect
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => edit(s.config)}
            >
              Edit connection
            </button>
            <button
              className="button secondary danger-subtle"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    "Remove this MCP connection, its credentials and grants? History and memory remain.",
                  )
                )
                  void run(() => bridge.mcpAction(s.config.id, "remove"));
              }}
            >
              Remove connection
            </button>
          </div>
          {!!s.tools.length && (
            <p>
              Tools start blocked. Choose “Ask every time” for desktop approval,
              or “Allow” for calls without confirmation from desktop and your
              paired Telegram account.
            </p>
          )}
          {!!s.tools.length && (
            <ToolPermissions
              tools={s.tools}
              scope={s.config.id}
              disabled={busy}
              onChange={(t, policy) => {
                if (
                  policy === "allow" &&
                  !window.confirm(
                    `Allow ${t.name} without asking? This may modify external data. Server safety annotations are not guarantees.`,
                  )
                )
                  return;
                void run(() =>
                  bridge.mcpGrant(s.config.id, t.name, t.fingerprint, policy),
                );
              }}
            />
          )}
          {!s.tools.length && (
            <p className="connection-next-step">
              Connect to discover the tools available from this server.
            </p>
          )}
        </article>
      ))}
      <details className="mcp-audit integration-disclosure">
        <summary>Tool activity · {data?.audit.length ?? 0} entries</summary>
        <p>
          Last 200 events. Arguments, results, tokens and raw server errors are
          not logged. Stop requests cannot undo effects already accepted by an
          external service.
        </p>
        {data?.audit.length ? (
          <ol>
            {[...data.audit].reverse().map((a, i) => (
              <li key={`${a.id}-${i}`}>
                <time>{new Date(a.at).toLocaleString()}</time> · {a.serverId}/
                {a.tool} · {a.outcome}
              </li>
            ))}
          </ol>
        ) : (
          <p>No tool calls yet.</p>
        )}
      </details>
    </section>
  );
}
