import { useState } from "react";
import { bridge } from "../bridge";
import { MINECRAFT_ID } from "../shared/minecraft";
import {
  mcpConfigSchema,
  mcpSecretsSchema,
  type McpConfig,
  type McpSnapshot,
  type ToolPolicy,
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
      <div className="section-heading">
        <h2>MCP connections</h2>
        <p>
          Give your companion new tools, one permission at a time. Changes apply
          immediately.
        </p>
      </div>
      <p>
        Local servers run as trusted programs with your OS account’s access, not
        in a sandbox. Remote servers receive tool arguments. Only connect
        servers you trust. The bundled Minecraft adapter has its own controls
        above.
      </p>
      <div className="button-row">
        <button
          className="button primary"
          disabled={busy}
          onClick={() => edit()}
        >
          Add MCP connection
        </button>
        <button
          className="button secondary"
          onClick={() =>
            void run(
              () => bridge.stopTools(),
              "Tools stopped. Reconnect explicitly to resume.",
            )
          }
        >
          Emergency stop tools
        </button>
      </div>
      {data?.stopped && (
        <p role="status">
          Emergency stop is active. All MCP connections are disabled.
        </p>
      )}
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
        <div className="mcp-approvals">
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
        <p className="mcp-empty">
          No connections yet. Add a trusted MCP server, then choose which tools
          your companion may use.
        </p>
      )}
      {data?.servers.map((s) => (
        <article key={s.config.id} className="mcp-connection">
          <div className="section-heading">
            <h3>{s.config.name}</h3>
            <p>
              {s.status} ·{" "}
              {s.config.transport === "stdio"
                ? "Local program"
                : "Streamable HTTP"}{" "}
              · character {s.config.characterId} ·{" "}
              {s.hasSecrets ? "Credentials saved" : "No saved credentials"}
            </p>
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
              className="button secondary"
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
              Tools are blocked by default. “Ask every time” makes a tool
              available to the LLM but waits for desktop approval. “Allow”
              permits calls without further confirmation, including requests
              from your paired Telegram account.
            </p>
          )}
          {s.tools.map((t) => (
            <div className="mcp-tool" key={t.name}>
              <label className="field">
                <span>{t.name}</span>
                <select
                  aria-label={`Permission for ${s.config.id}/${t.name}`}
                  value={t.policy}
                  disabled={busy}
                  onChange={(e) => {
                    const policy = e.target.value as ToolPolicy;
                    if (
                      policy === "allow" &&
                      !window.confirm(
                        `Allow ${t.name} without asking? This may modify external data. Server safety annotations are not guarantees.`,
                      )
                    )
                      return;
                    void run(() =>
                      bridge.mcpGrant(
                        s.config.id,
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
              <details>
                <summary>
                  Description and input schema (untrusted server data)
                </summary>
                <p>{t.description || "No description provided."}</p>
                <pre>{JSON.stringify(t.inputSchema, null, 2)}</pre>
              </details>
            </div>
          ))}
        </article>
      ))}
      <details className="mcp-audit">
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
