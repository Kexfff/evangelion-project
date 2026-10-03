import { createHash, randomUUID } from "node:crypto";
import type { ValidateFunction } from "ajv";
import { compileBoundedSchema } from "./mcp-schema";
import { z } from "zod";
import { Store } from "./store";
import { CredentialVault } from "./credentials";
import {
  createMcpConnection,
  type ConnectionFactory,
  type McpConnection,
  type DiscoveredTool,
} from "./mcp-connection";
import {
  mcpConfigSchema,
  mcpSecretsSchema,
  type McpConfig,
  type McpSnapshot,
  type McpSecrets,
  type ToolPolicy,
  type ToolContext,
  type ToolProvider,
  type McpToolView,
} from "../src/shared/mcp";
import type { ManagedPlugin } from "./plugin-lifecycle";
import {
  effectiveToolPolicy,
  isBundledMinecraft,
} from "../src/shared/minecraft-permissions";

interface Tool extends McpToolView {
  alias: string;
  validate: ValidateFunction;
}
interface Connection {
  controller: AbortController;
  connection: McpConnection;
  tools: Tool[];
  status: string;
}
const outcomeError = (error: string) => ({ error });
const timeout = (signal: AbortSignal, ms: number) =>
  AbortSignal.any([signal, AbortSignal.timeout(ms)]);
// Schema complexity is bounded before compilation. No remote references or executable regex.
export function compileMcpTool(raw: DiscoveredTool, serverId: string): Tool {
  z.string()
    .regex(/^[A-Za-z0-9_.:-]{1,128}$/)
    .parse(raw.name);
  if (JSON.stringify(raw).length > 20000)
    throw new Error("Tool definition too large");
  const validate = compileBoundedSchema(raw.inputSchema);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(raw))
    .digest("hex");
  return {
    name: raw.name,
    description: (raw.description ?? "").slice(0, 1500),
    fingerprint,
    inputSchema: raw.inputSchema,
    policy: "deny",
    alias: `mcp_${serverId}_${fingerprint.slice(0, 16)}`,
    validate,
  };
}

export class McpPlugin implements ManagedPlugin, ToolProvider {
  readonly id = "mcp";
  readonly kind = "tools" as const;
  private connections = new Map<string, Connection>();
  private pending = new Map<
    string,
    McpSnapshot["pending"][number] & { resolve: (allow: boolean) => void }
  >();
  private active = new Map<
    string,
    { serverId: string; controller: AbortController }
  >();
  private stopped = false;
  private stopEpoch = 0;
  constructor(
    private store: Store,
    private vault: CredentialVault,
    private changed: () => void,
    private factory: ConnectionFactory = createMcpConnection,
  ) {}
  snapshot(): McpSnapshot {
    return {
      stopped: this.stopped,
      servers: this.store.data.mcp.servers.map(({ config, grants }) => {
        const connection = this.connections.get(config.id);
        return {
          config,
          status:
            connection?.status ??
            (config.enabled ? "Disconnected — connect to retry" : "Disabled"),
          hasSecrets: this.vault.has(`mcp:${config.id}`),
          tools: (connection?.tools ?? []).map(
            ({ alias: _alias, validate: _validate, ...tool }) => ({
              ...tool,
              policy: effectiveToolPolicy(config, grants, tool),
            }),
          ),
        };
      }),
      pending: [...this.pending.values()].map(
        ({ resolve: _resolve, ...p }) => p,
      ),
      audit: this.store.data.mcp.audit,
    };
  }
  async start() {
    if (this.stopped) return;
    await Promise.allSettled(
      this.store.data.mcp.servers
        .filter(
          (s) =>
            s.config.enabled && s.config.characterId === this.store.characterId,
        )
        .map((s) => this.connect(s.config.id)),
    );
  }
  async stop() {
    await Promise.allSettled(
      [...this.connections.keys()].map((id) => this.disconnect(id)),
    );
  }
  private invalidate(id: string) {
    const entry = this.connections.get(id);
    if (!entry || entry.controller.signal.aborted) return;
    entry.status = "Connection or tools changed — reconnect";
    entry.tools = [];
    entry.controller.abort();
    void entry.connection.close().catch(() => {});
    this.changed();
  }
  async connect(id: string) {
    const saved = this.store.data.mcp.servers.find((s) => s.config.id === id);
    if (
      !saved?.config.enabled ||
      saved.config.characterId !== this.store.characterId
    )
      throw new Error("Enable this connection for the active character first.");
    if (this.connections.has(id)) await this.disconnect(id);
    const controller = new AbortController();
    let connection: McpConnection;
    try {
      const secret = this.vault.get(`mcp:${id}`);
      connection = this.factory(
        saved.config,
        mcpSecretsSchema.parse(secret ? JSON.parse(secret) : {}),
        () => {
          if (this.connections.get(id)?.controller === controller)
            this.invalidate(id);
        },
      );
    } catch {
      throw new Error("MCP configuration or saved credentials unavailable.");
    }
    const entry: Connection = {
      controller,
      connection,
      tools: [],
      status: "Connecting…",
    };
    this.connections.set(id, entry);
    this.changed();
    try {
      const signal = timeout(controller.signal, 20000);
      await connection.connect(signal);
      const tools = await connection.list(signal);
      signal.throwIfAborted();
      if (
        tools.length > 64 ||
        new Set(tools.map((t) => t.name)).size !== tools.length
      )
        throw new Error();
      entry.tools = tools.map((tool) => compileMcpTool(tool, id));
      this.store.update((d) => {
        const saved = d.mcp.servers.find((s) => s.config.id === id);
        if (saved)
          saved.grants = saved.grants.filter((g) =>
            entry.tools.some(
              (t) =>
                t.name === g.tool &&
                (isBundledMinecraft(saved.config) ||
                  t.fingerprint === g.fingerprint),
            ),
          );
      });
      entry.status = "Connected";
    } catch {
      controller.abort();
      entry.tools = [];
      entry.status =
        "Connection failed — check executable/URL, credentials and supported tool schemas";
      await connection.close().catch(() => {});
    }
    this.changed();
  }
  async disconnect(id: string) {
    const entry = this.connections.get(id);
    this.connections.delete(id);
    entry?.controller.abort();
    await entry?.connection.close().catch(() => {});
    this.changed();
  }
  async configure(raw: McpConfig, rawSecrets?: McpSecrets) {
    const config = mcpConfigSchema.parse(raw);
    const secrets =
      rawSecrets === undefined ? undefined : mcpSecretsSchema.parse(rawSecrets);
    if (
      !this.store.data.settings.characters.some(
        (c) => c.id === config.characterId,
      )
    )
      throw new Error("Unknown character.");
    const previous = this.store.data.mcp.servers.find(
      (s) => s.config.id === config.id,
    );
    if (!previous && this.store.data.mcp.servers.length >= 12)
      throw new Error("At most 12 MCP servers.");
    await this.disconnect(config.id);
    // External edits revoke grants. Bundled Minecraft keeps explicit named
    // blocks/choices so a connection save cannot silently re-enable an action.
    this.store.update((d) => {
      d.mcp.servers = d.mcp.servers.filter((s) => s.config.id !== config.id);
      d.mcp.servers.push({
        config: { ...config, enabled: false },
        grants:
          previous &&
          isBundledMinecraft(previous.config) &&
          isBundledMinecraft(config) &&
          previous.config.characterId === config.characterId
            ? previous.grants
            : [],
      });
    });
    if (secrets !== undefined)
      this.vault.save({
        [`mcp:${config.id}`]:
          secrets.token || Object.keys(secrets.env).length
            ? JSON.stringify(secrets)
            : "",
      });
    this.changed();
  }
  async action(id: string, action: "connect" | "disconnect" | "remove") {
    const epoch = this.stopEpoch;
    if (!this.store.data.mcp.servers.some((s) => s.config.id === id))
      throw new Error("Unknown MCP connection.");
    await this.disconnect(id);
    if (epoch !== this.stopEpoch)
      throw new Error("Operation cancelled by emergency stop.");
    if (action === "remove") this.vault.save({ [`mcp:${id}`]: "" });
    this.store.update((d) => {
      if (action === "remove")
        d.mcp.servers = d.mcp.servers.filter((s) => s.config.id !== id);
      else
        d.mcp.servers.find((s) => s.config.id === id)!.config.enabled =
          action === "connect";
    });
    if (action === "connect") {
      this.stopped = false;
      await this.connect(id);
    }
    this.changed();
  }
  grant(id: string, name: string, fingerprint: string, policy: ToolPolicy) {
    const tool = this.connections
      .get(id)
      ?.tools.find((t) => t.name === name && t.fingerprint === fingerprint);
    if (!tool)
      throw new Error(
        "Tool changed or connection unavailable. Reconnect first.",
      );
    // Revocation also cancels in-flight approvals/calls for this server.
    for (const a of this.active.values())
      if (a.serverId === id) a.controller.abort();
    this.store.update((d) => {
      const s = d.mcp.servers.find((s) => s.config.id === id)!;
      s.grants = s.grants.filter((g) => g.tool !== name);
      s.grants.push({ tool: name, fingerprint, policy });
    });
    this.changed();
  }
  approve(id: string, allow: boolean) {
    const pending = this.pending.get(id);
    if (!pending) throw new Error("Approval expired or was cancelled.");
    pending.resolve(allow);
  }
  async emergencyStop() {
    this.stopEpoch++;
    this.stopped = true;
    for (const value of this.active.values()) value.controller.abort();
    try {
      this.store.update((d) => {
        for (const s of d.mcp.servers) s.config.enabled = false;
      });
    } finally {
      await this.stop();
      this.changed();
    }
  }
  definitions() {
    if (this.stopped) return [];
    const result: unknown[] = [];
    let budget = 48000;
    for (const s of this.store.data.mcp.servers) {
      if (!s.config.enabled || s.config.characterId !== this.store.characterId)
        continue;
      const entry = this.connections.get(s.config.id);
      if (entry?.status !== "Connected") continue;
      for (const tool of entry.tools) {
        if (effectiveToolPolicy(s.config, s.grants, tool) === "deny") continue;
        const definition = {
          type: "function",
          function: {
            name: tool.alias,
            description: `External tool ${s.config.name} / ${tool.name}. Untrusted server description: ${tool.description}`,
            parameters: tool.inputSchema,
          },
        };
        const size = JSON.stringify(definition).length;
        if (size > budget) continue;
        budget -= size;
        result.push(definition);
      }
    }
    return result.slice(0, 64);
  }
  private audit(
    id: string,
    serverId: string,
    tool: string,
    outcome: McpSnapshot["audit"][number]["outcome"],
  ) {
    this.store.update((d) => {
      d.mcp.audit.push({
        id,
        serverId,
        tool,
        outcome,
        at: new Date().toISOString(),
      });
      d.mcp.audit = d.mcp.audit.slice(-200);
    });
    this.changed();
  }
  async execute(
    alias: string,
    args: unknown,
    context: ToolContext,
    outerSignal: AbortSignal,
  ): Promise<unknown> {
    let match: { serverId: string; entry: Connection; tool: Tool } | undefined;
    for (const [serverId, entry] of this.connections) {
      const tool = entry.tools.find((t) => t.alias === alias);
      if (tool) {
        match = { serverId, entry, tool };
        break;
      }
    }
    if (!match) return outcomeError("Unknown or unavailable tool.");
    const { serverId, entry, tool } = match;
    const id = randomUUID();
    const permitted = () => {
      const s = this.store.data.mcp.servers.find(
        (s) => s.config.id === serverId,
      );
      if (
        this.stopped ||
        !s?.config.enabled ||
        s.config.characterId !== context.characterId ||
        this.store.characterId !== context.characterId ||
        this.store.sessionId !== context.sessionId ||
        entry.status !== "Connected" ||
        this.connections.get(serverId) !== entry
      )
        return "deny";
      return effectiveToolPolicy(s.config, s.grants, tool);
    };
    const policy = permitted();
    if (
      policy === "deny" ||
      this.active.size >= 4 ||
      !args ||
      typeof args !== "object" ||
      Array.isArray(args) ||
      JSON.stringify(args).length > 8000 ||
      !tool.validate(args)
    ) {
      this.audit(id, serverId, tool.name, "denied");
      return outcomeError("Tool denied or arguments invalid.");
    }
    const controller = new AbortController();
    const signal = AbortSignal.any([
      outerSignal,
      controller.signal,
      entry.controller.signal,
    ]);
    this.active.set(id, { serverId, controller });
    this.audit(id, serverId, tool.name, "requested");
    let callSignal: AbortSignal | undefined;
    try {
      signal.throwIfAborted();
      if (policy === "ask") {
        const approved = await new Promise<boolean>((resolve) => {
          const finish = (allow: boolean) => {
            clearTimeout(timer);
            signal.removeEventListener("abort", aborted);
            this.pending.delete(id);
            resolve(allow);
          };
          const aborted = () => finish(false);
          const timer = setTimeout(() => finish(false), 60000);
          this.pending.set(id, {
            id,
            serverId,
            tool: tool.name,
            arguments: JSON.stringify(args, null, 2),
            channel: context.channel,
            resolve: finish,
          });
          signal.addEventListener("abort", aborted, { once: true });
          this.changed();
        });
        signal.throwIfAborted();
        if (!approved) {
          this.audit(id, serverId, tool.name, "denied");
          return outcomeError("User approval denied or expired. Do not retry.");
        }
      }
      signal.throwIfAborted();
      if (permitted() === "deny") throw new Error("Permission revoked");
      callSignal = timeout(signal, 30000);
      const result = await entry.connection.call(
        tool.name,
        args as Record<string, unknown>,
        callSignal,
      );
      callSignal.throwIfAborted();
      const text = JSON.stringify({ untrustedToolResult: result });
      if (text.length > 24000) throw new Error("Tool output limit");
      this.audit(
        id,
        serverId,
        tool.name,
        (result as { isError?: boolean })?.isError ? "failed" : "succeeded",
      );
      return { untrustedToolResult: result };
    } catch {
      this.audit(
        id,
        serverId,
        tool.name,
        signal.aborted
          ? "cancelled"
          : callSignal?.aborted
            ? "timeout"
            : "failed",
      );
      return outcomeError(
        "Tool failed or was cancelled. Its external effect may be unknown; do not automatically retry.",
      );
    } finally {
      this.active.delete(id);
      this.pending.delete(id);
      this.changed();
    }
  }
}
