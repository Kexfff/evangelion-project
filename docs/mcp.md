# Plugins and MCP tools

[← Documentation](README.md) · [Project home](../README.md)

Sprint 4's MCP foundation landed in v0.4.0. Telegram remains a bundled chat channel; MCP adds separately configured tool providers to the same companion. v0.4.1 adds a [bundled Minecraft adapter](minecraft.md) for Java Edition LAN worlds, with persistent job history and bounded background actions. Proactive/autonomous game planning remains future work.

## Connect a server

1. Open **Settings → Plugins & MCP → MCP connections → Add MCP connection**.
2. Give it a unique ID and a name. The connection is bound to the currently selected character.
3. Choose **Local program (stdio)** or **Remote endpoint (Streamable HTTP)**.
4. For a local server, supply its executable and arguments as a JSON array. Prefer an absolute executable path. Arguments are passed directly without shell expansion. For HTTP, supply an HTTPS MCP endpoint; plain HTTP is allowed only on loopback (`localhost`, `127.0.0.1`, or `::1`). Redirects, URL credentials, query strings and fragments are rejected.
5. Optionally enter secret environment variables as a JSON object for stdio, or a bearer token for HTTP. These use the existing credential vault. Leave **Replace saved credentials** unchecked while editing to retain them; check it and leave the fields empty to clear them.
6. Save, then **Connect / reconnect**. Review the native trust confirmation. Saving alone never runs a program or contacts a server.
7. Review the discovered tools and choose their permissions. All tools start **Blocked**. Ask the companion to use an enabled tool from desktop or your paired Telegram account.

External MCP servers must already be installed or hosted: the app does not install packages, runtimes or servers for you. Once configured and trusted, the app launches a local server itself. The bundled Minecraft adapter includes its runtime dependencies and has its own **Minecraft** view; no separate bot process or executable configuration is needed.

The integration cards switch between Minecraft, MCP connections and Telegram without discarding unfinished forms. Search discovered tools by name or description, filter by permission, and expand a tool to inspect its full description and schema. Minecraft also groups tools by gameplay activity. Permissions apply immediately; connection forms have their own Save buttons. Emergency stop is available from every integration view, and a new approval request opens the MCP view automatically.

The application must remain running. Enabled connections for the active character start when the app starts and reconnect after ordinary settings changes. Disconnect disables startup. Failed connections and changed tool lists require explicit reconnect; there is no automatic retry of tool execution or replay of ambiguous effects. The client negotiates protocol versions through the official SDK. Unsupported protocol versions fail closed.

## Permissions and approvals

- **Blocked:** not advertised to the LLM and cannot execute.
- **Ask every time:** advertised to the LLM, but every call requires a one-time approval in the desktop settings. Exact tool arguments and the originating channel are displayed. Approval expires after 60 seconds. Telegram cannot approve calls remotely in this release.
- **Allow without asking:** the selected tool may execute for user-requested desktop or paired Telegram conversations without another confirmation. Use this only when you trust the tool's behavior and its access. Server-provided safety annotations are not treated as permission guarantees.

Grants bind to the connection, character, tool name and a fingerprint of the discovered definition. Editing a connection resets its grants, including when changing credentials. A changed definition cannot inherit an old grant. Character/session ownership, live connection and grants are checked again immediately before execution. Revoking a grant cancels pending calls for that server. Other characters cannot use the connection.

**Bundled Minecraft exception (v0.4.6):** its known app-shipped game tools default to Allow and preserve explicit Blocked/Ask choices by stable tool name across description changes and connection saves for the same character. These are the sole Minecraft action permissions; there is no second block/chat gate. Unknown tool names, other server IDs and non-bundled endpoints do not inherit this exception. This does not loosen permissions for external MCP servers or PC access.

Pending approvals appear in **Plugins & MCP**; banners in other settings tabs and the companion point to them. An approval is not a standing grant. Arguments may contain private information, so inspect them before sending them to an external service.

Only ordinary user-initiated conversations receive external tools. Proactive messages and scheduled reminders still cannot call external tools. Tool-capable LLM support is required. While tools are available, the existing bounded, non-streaming tool loop speaks only the final answer, not intermediate planning or tool JSON. Normal chat remains streaming when no tools are available.

## Stop and failure behavior

**Emergency stop tools** aborts pending approvals/calls, disconnects MCP servers, persistently disables their startup and cancels the current conversation. Reconnect explicitly to resume. Normal chat cancellation also propagates to its current tool request. Quit awaits managed connection cleanup, including closing/killing direct stdio children through the SDK. Arbitrary programs are responsible for their own independently spawned descendants.

Cancellation is cooperative at a remote server. Neither closing a connection nor killing a local process can undo an operation already accepted by an external service. A failed or interrupted call may have an unknown outcome; the app does not automatically repeat it. The LLM dispatcher refuses another call to the same failed/denied tool during that turn.

The last 200 tool audit events persist locally: timestamp, connection ID, tool name and outcome. They do not contain arguments, tool results, bearer tokens, environment secrets, raw stderr or provider/server error bodies. MCP configuration, grants, credentials and audit logs are excluded from memory exports. Configuration and audit history in the ordinary database/backup are plaintext; only credentials use the vault. Removing a connection deletes its saved credentials/configuration/grants, not chat memories or audit history. Earlier non-secret configuration may remain in the database backup.

## Limits and supported subset

- Up to 12 configured connections, 64 tools per server and eight discovery pagination cursors.
- At most 64 external tools and 48,000 serialized characters of external tool definitions per LLM request. Tools beyond that budget are not advertised.
- Tool definitions: 20,000 characters each; input/output schemas: 16,000 characters, 1,500 traversed nodes and depth 16. Standard object schemas, types, required fields, enums, bounds and combinators are supported with Draft 2020-12 or explicitly declared Draft 7. References (`$ref`, `$dynamicRef`), regex validation (`pattern`, `patternProperties`) and `format` are currently rejected. An unsupported schema fails discovery; the app does not silently skip validation.
- Stdio buffers and individual HTTP response streams are capped at 1 MiB. A long-lived HTTP notification stream exceeding that bound requires reconnect.
- Connection/discovery: 20-second overall deadline; individual discovery requests: 15 seconds. Calls: 30 seconds; approvals: 60 seconds. Minecraft action calls return a job ID promptly; its bounded background jobs have separate stop/progress controls. Generic MCP servers have no background-job manager.
- Arguments: 8,000 characters. A result: 24,000 characters. Cumulative results per turn: 48,000 characters. At most three tool rounds of four calls each, then a final-answer request; calls execute sequentially.
- Tools only: no MCP resources/prompts UI, sampling, elicitation, filesystem roots, OAuth login, legacy HTTP+SSE transport, marketplace or third-party in-process plugin loading.

## Architecture and trust boundary

`electron/plugin-lifecycle.ts` owns the shared lifecycle contract and failure-isolated registry. `electron/plugin-host.ts` coordinates it; `electron/telegram-plugin.ts` owns Telegram configuration/grants and its channel adapter. Channel ports remain separate from the `ToolProvider` interface in `src/shared/mcp.ts`.

`electron/mcp-plugin.ts` owns connection state, grants, approvals, auditing and dispatch. `electron/mcp-connection.ts` wraps the official SDK's stdio and Streamable HTTP clients. `electron/mcp-schema.ts` validates bounded schemas. The existing conversation runtime combines approved external tools with reminder tools; MCP servers never receive the app's LLM/ASR/TTS keys or a database handle.

**Local MCP servers are trusted executable programs, not sandboxed extensions.** They run with your OS account's access and could independently read files or access the network, even without tool grants. The vault protects stored credentials; it does not isolate them from a hostile local program with your account's filesystem access. Only explicitly configured environment secrets plus the SDK's small default environment are supplied, never the whole app environment. HTTP credentials go only to the configured endpoint, without redirect forwarding.

Tool descriptions and returned content are treated as untrusted data, not instructions. This reduces prompt-injection exposure but is not a proof that a model cannot be influenced; tool permissions and one-call approvals are the actual execution boundary. Do not grant blanket access to sensitive or destructive tools.

Protocol references: [MCP lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle), [transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools), and the [official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk).
