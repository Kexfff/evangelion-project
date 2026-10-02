import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Store, atomicWrite } from "../electron/store";
import {
  compileBoundedSchema,
  boundedSchemaValidator,
} from "../electron/mcp-schema";
import { CredentialVault } from "../electron/credentials";
import { McpPlugin, compileMcpTool } from "../electron/mcp-plugin";
import { PluginRegistry } from "../electron/plugin-lifecycle";
import {
  createMcpConnection,
  boundedMcpFetch,
  type ConnectionFactory,
} from "../electron/mcp-connection";
import { mcpConfigSchema, type ToolPolicy } from "../src/shared/mcp";
import { CompanionRuntime } from "../electron/runtime";
import { OpenAICompatibleProvider } from "../electron/providers";
import { defaultSettings } from "../src/shared/schema";

const directories: string[] = [];
const plugins: McpPlugin[] = [];
const cleanup: (() => Promise<unknown>)[] = [];
const echo = {
  name: "echo",
  description: "Echo text",
  inputSchema: {
    type: "object" as const,
    properties: { text: { type: "string", maxLength: 100 } },
    required: ["text"],
    additionalProperties: false,
  },
};
const config = () =>
  mcpConfigSchema.parse({
    id: "fixture",
    name: "Fixture",
    transport: "stdio",
    command: process.execPath,
    args: [path.resolve("tests/fixtures/mcp-server.mjs")],
    characterId: "eva",
  });
function harness() {
  const dir = mkdtempSync(path.join(tmpdir(), "eva-mcp-test-"));
  directories.push(dir);
  const store = new Store(dir),
    vault = new CredentialVault(dir, null);
  let invalidated = () => {};
  const connection = {
    connect: vi.fn(async () => {}),
    list: vi.fn(async () => [structuredClone(echo)]),
    call: vi.fn(
      async (
        _name: string,
        args: Record<string, unknown>,
        _signal: AbortSignal,
      ): Promise<unknown> => ({ content: [{ type: "text", text: args.text }] }),
    ),
    close: vi.fn(async () => {}),
  };
  const factory: ConnectionFactory = (_config, _secrets, invalidate) => {
    invalidated = invalidate;
    return connection;
  };
  const changed = vi.fn();
  const plugin = new McpPlugin(store, vault, changed, factory);
  plugins.push(plugin);
  const ctx = () => ({
    characterId: store.characterId,
    sessionId: store.sessionId,
    channel: "desktop" as const,
  });
  const grant = (policy: ToolPolicy) => {
    const tool = plugin.snapshot().servers[0].tools[0];
    plugin.grant("fixture", tool.name, tool.fingerprint, policy);
    return (
      (plugin.definitions()[0] as any)?.function.name ??
      compileMcpTool(echo, "fixture").alias
    );
  };
  const ready = async (policy: ToolPolicy = "ask") => {
    await plugin.configure(config(), {
      token: "",
      env: { MCP_FIXTURE_KEY: "fixture-secret" },
    });
    await plugin.action("fixture", "connect");
    return grant(policy);
  };
  return {
    dir,
    store,
    vault,
    plugin,
    connection,
    factory,
    ctx,
    grant,
    ready,
    invalidate: () => invalidated(),
  };
}
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(plugins.splice(0).map((p) => p.stop()));
  for (const fn of cleanup.splice(0)) await fn();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true });
});

describe("shared lifecycle and persisted MCP configuration", () => {
  it("loads pre-MCP profiles without resetting Telegram or memory", () => {
    const h = harness();
    const old = JSON.parse(readFileSync(h.store.file, "utf8"));
    delete old.mcp;
    old.telegram.installedVersion = "1.0.0";
    old.facts.push({
      id: "old",
      characterId: "eva",
      text: "Keep this memory",
      source: "manual",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    atomicWrite(h.store.file, JSON.stringify(old));
    const loaded = new Store(h.dir);
    expect(loaded.data.mcp).toEqual({ servers: [], audit: [] });
    expect(loaded.data.telegram.installedVersion).toBe("1.0.0");
    expect(loaded.data.facts[0].text).toBe("Keep this memory");
  });
  it("validates bounded Draft 2020-12 inputs and structured outputs", () => {
    const schema = {
      ...echo.inputSchema,
      $schema: "https://json-schema.org/draft/2020-12/schema",
    };
    expect(compileBoundedSchema(schema)({ text: "valid" })).toBe(true);
    expect(compileBoundedSchema(schema)({ text: 1 })).toBe(false);
    expect(boundedSchemaValidator.getValidator(schema)({ text: 1 }).valid).toBe(
      false,
    );
    expect(() =>
      boundedSchemaValidator.getValidator({
        type: "object",
        properties: { text: { pattern: "(a+)+$" } },
      }),
    ).toThrow();
  });
  it("isolates lifecycle failures and rejects duplicate plugin IDs", async () => {
    const registry = new PluginRegistry();
    const good = {
      id: "good",
      kind: "tools" as const,
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
    };
    registry.register(good);
    registry.register({
      id: "bad",
      kind: "channel",
      start: async () => {
        throw new Error();
      },
      stop: async () => {
        throw new Error();
      },
    });
    expect(() => registry.register(good)).toThrow();
    await registry.start();
    await registry.stop();
    expect(good.start).toHaveBeenCalledOnce();
    expect(good.stop).toHaveBeenCalledOnce();
  });
  it("persists encrypted namespaced credentials and grants, never credentials in snapshots or database", async () => {
    const h = harness();
    await h.ready("allow");
    expect(readFileSync(h.vault.file, "utf8")).not.toContain("fixture-secret");
    expect(readFileSync(h.store.file, "utf8")).not.toContain("fixture-secret");
    expect(JSON.stringify(h.plugin.snapshot())).not.toContain("fixture-secret");
    const store = new Store(h.dir),
      vault = new CredentialVault(h.dir, null);
    expect(JSON.parse(vault.get("mcp:fixture")).env.MCP_FIXTURE_KEY).toBe(
      "fixture-secret",
    );
    const restarted = new McpPlugin(store, vault, () => {}, h.factory);
    plugins.push(restarted);
    await restarted.start();
    expect(restarted.definitions()).toHaveLength(1);
    await restarted.configure(config());
    expect(restarted.snapshot().servers[0].config.enabled).toBe(false);
    expect(store.data.mcp.servers[0].grants).toEqual([]);
    await restarted.action("fixture", "remove");
    expect(vault.has("mcp:fixture")).toBe(false);
  });
  it("rejects unsafe HTTP URLs and empty executables", () => {
    for (const url of [
      "http://example.com/mcp",
      "https://a:b@example.com/mcp",
      "https://example.com/mcp?key=x",
      "file:///tmp/test",
    ])
      expect(
        mcpConfigSchema.safeParse({ ...config(), transport: "http", url })
          .success,
      ).toBe(false);
    expect(
      mcpConfigSchema.safeParse({ ...config(), command: "" }).success,
    ).toBe(false);
    expect(
      mcpConfigSchema.safeParse({
        ...config(),
        transport: "http",
        url: "http://127.0.0.1:1234/mcp",
      }).success,
    ).toBe(true);
  });
  it("bounds discovery and rejects duplicate names and unsupported schemas", async () => {
    expect(() =>
      compileMcpTool(
        {
          ...echo,
          inputSchema: { type: "object", $ref: "https://example.com/schema" },
        },
        "fixture",
      ),
    ).toThrow();
    expect(() =>
      compileMcpTool(
        {
          ...echo,
          inputSchema: {
            type: "object",
            properties: { text: { type: "string", pattern: "(a+)+$" } },
          },
        },
        "fixture",
      ),
    ).toThrow();
    const h = harness();
    h.connection.list.mockResolvedValue([echo, echo]);
    await h.ready().catch(() => {});
    expect(h.plugin.snapshot().servers[0].status).toContain("failed");
    expect(h.plugin.definitions()).toEqual([]);
  });
});

describe("MCP tool authorization and cancellation", () => {
  it("still disconnects when persisting emergency stop fails", async () => {
    const h = harness();
    await h.ready("allow");
    vi.spyOn(h.store, "update").mockImplementationOnce(() => {
      throw new Error("Disk unavailable");
    });
    await expect(h.plugin.emergencyStop()).rejects.toThrow("Disk unavailable");
    expect(h.connection.close).toHaveBeenCalled();
    expect(h.plugin.definitions()).toEqual([]);
  });
  it("marks failed startup safely without replaying connection attempts", async () => {
    const h = harness();
    h.connection.connect.mockRejectedValue(new Error("secret-startup-error"));
    await h.plugin.configure(config());
    await h.plugin.action("fixture", "connect");
    expect(h.connection.connect).toHaveBeenCalledOnce();
    expect(h.plugin.snapshot().servers[0].status).toContain("failed");
    expect(JSON.stringify(h.plugin.snapshot())).not.toContain(
      "secret-startup-error",
    );
  });
  it("blocks by default, validates arguments and logs no argument/result content", async () => {
    const h = harness();
    const alias = await h.ready("deny");
    expect(h.plugin.definitions()).toEqual([]);
    expect(
      await h.plugin.execute(
        alias,
        { text: "private" },
        h.ctx(),
        new AbortController().signal,
      ),
    ).toHaveProperty("error");
    h.grant("allow");
    await h.plugin.execute(
      alias,
      { text: 42 },
      h.ctx(),
      new AbortController().signal,
    );
    expect(h.connection.call).not.toHaveBeenCalled();
    await h.plugin.execute(
      alias,
      { text: "private" },
      h.ctx(),
      new AbortController().signal,
    );
    expect(h.connection.call).toHaveBeenCalledOnce();
    expect(JSON.stringify(h.store.data.mcp.audit)).not.toContain("private");
    expect(h.store.data.mcp.audit.at(-1)?.outcome).toBe("succeeded");
  });
  it("requires exact one-call approval and denies subsequent calls separately", async () => {
    const h = harness();
    const alias = await h.ready();
    const first = h.plugin.execute(
      alias,
      { text: "approved" },
      h.ctx(),
      new AbortController().signal,
    );
    expect(h.plugin.snapshot().pending[0].arguments).toContain("approved");
    expect(h.connection.call).not.toHaveBeenCalled();
    const id = h.plugin.snapshot().pending[0].id;
    h.plugin.approve(id, true);
    await first;
    expect(() => h.plugin.approve(id, true)).toThrow();
    const second = h.plugin.execute(
      alias,
      { text: "denied" },
      h.ctx(),
      new AbortController().signal,
    );
    h.plugin.approve(h.plugin.snapshot().pending[0].id, false);
    expect(await second).toHaveProperty("error");
    expect(h.connection.call).toHaveBeenCalledOnce();
  });
  it("expires approvals without executing", async () => {
    const h = harness();
    const alias = await h.ready();
    vi.useFakeTimers();
    const pending = h.plugin.execute(
      alias,
      { text: "timeout" },
      h.ctx(),
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(60001);
    await pending;
    expect(h.connection.call).not.toHaveBeenCalled();
    expect(h.plugin.snapshot().pending).toEqual([]);
  });
  it("rechecks session ownership after approval", async () => {
    const h = harness();
    const alias = await h.ready();
    const pending = h.plugin.execute(
      alias,
      { text: "test" },
      h.ctx(),
      new AbortController().signal,
    );
    h.store.update((d) => {
      d.sessions.eva = "new-session";
    });
    h.plugin.approve(h.plugin.snapshot().pending[0].id, true);
    expect(await pending).toHaveProperty("error");
    expect(h.connection.call).not.toHaveBeenCalled();
  });
  it("rejects cross-character and stale-session use", async () => {
    const h = harness();
    const alias = await h.ready("allow");
    await h.plugin.execute(
      alias,
      { text: "test" },
      { ...h.ctx(), characterId: "other" },
      new AbortController().signal,
    );
    await h.plugin.execute(
      alias,
      { text: "test" },
      { ...h.ctx(), sessionId: "other" },
      new AbortController().signal,
    );
    expect(h.connection.call).not.toHaveBeenCalled();
  });
  it("emergency stop aborts approval and persists disabled connections", async () => {
    const h = harness();
    const alias = await h.ready();
    const pending = h.plugin.execute(
      alias,
      { text: "stop" },
      h.ctx(),
      new AbortController().signal,
    );
    await h.plugin.emergencyStop();
    await pending;
    expect(h.plugin.snapshot().pending).toEqual([]);
    expect(h.connection.call).not.toHaveBeenCalled();
    expect(new Store(h.dir).data.mcp.servers[0].config.enabled).toBe(false);
    await h.plugin.start();
    expect(h.plugin.definitions()).toEqual([]);
  });
  it("permission revocation aborts in-flight tool execution", async () => {
    const h = harness();
    const alias = await h.ready("allow");
    h.connection.call.mockImplementation(
      async (_name, _args, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new Error("cancelled")),
            { once: true },
          );
        }),
    );
    const pending = h.plugin.execute(
      alias,
      { text: "stop" },
      h.ctx(),
      new AbortController().signal,
    );
    h.grant("deny");
    expect(await pending).toHaveProperty("error");
    expect(h.store.data.mcp.audit.at(-1)?.outcome).toBe("cancelled");
  });
  it("invalidates changed tools, reconnects only explicitly, and never transfers grants to changed metadata", async () => {
    const h = harness();
    await h.ready("allow");
    h.invalidate();
    expect(h.plugin.definitions()).toEqual([]);
    expect(h.connection.connect).toHaveBeenCalledOnce();
    h.connection.list.mockResolvedValue([{ ...echo, description: "Changed" }]);
    await h.plugin.action("fixture", "connect");
    expect(h.plugin.snapshot().servers[0].tools[0].policy).toBe("deny");
    expect(h.plugin.definitions()).toEqual([]);
  });
  it("redacts server failures and refuses oversized tool results", async () => {
    const h = harness();
    const alias = await h.ready("allow");
    h.connection.call.mockRejectedValueOnce(new Error("secret-provider-body"));
    const result = await h.plugin.execute(
      alias,
      { text: "test" },
      h.ctx(),
      new AbortController().signal,
    );
    expect(JSON.stringify([result, h.plugin.snapshot()])).not.toContain(
      "secret-provider-body",
    );
    h.connection.call.mockResolvedValueOnce({ content: "x".repeat(24001) });
    expect(
      await h.plugin.execute(
        alias,
        { text: "test" },
        h.ctx(),
        new AbortController().signal,
      ),
    ).toHaveProperty("error");
  });
});

describe("real MCP transports", () => {
  it("negotiates stdio, discovers tools, injects env, calls and cancels", async () => {
    const invalidated = vi.fn();
    const connection = createMcpConnection(
      config(),
      { token: "", env: { MCP_FIXTURE_KEY: "fixture-secret" } },
      invalidated,
    );
    cleanup.push(() => connection.close());
    const controller = new AbortController();
    await connection.connect(controller.signal);
    expect(
      (await connection.list(controller.signal)).map((t) => t.name),
    ).toEqual(["echo", "wait"]);
    expect(
      await connection.call("echo", { text: "hello" }, controller.signal),
    ).toMatchObject({
      content: [{ type: "text", text: "hello" }],
      structuredContent: { envInjected: true },
    });
    const waiting = connection.call("wait", {}, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toBeDefined();
    await connection.close();
    expect(invalidated).not.toHaveBeenCalled();
  });
  it.each([true, false])(
    "supports Streamable HTTP JSON response=%s without credential leakage or redirects",
    async (json) => {
      const requests: { authorization?: string; body: any }[] = [];
      const http = createServer(async (req, res) => {
        if (req.method !== "POST") {
          res.writeHead(405).end();
          return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString());
        requests.push({ authorization: req.headers.authorization, body });
        const server = new Server(
          { name: "http-fixture", version: "1" },
          { capabilities: { tools: {} } },
        );
        server.setRequestHandler(ListToolsRequestSchema, async () => ({
          tools: [echo],
        }));
        server.setRequestHandler(CallToolRequestSchema, async (request) => ({
          content: [
            { type: "text", text: String(request.params.arguments?.text) },
          ],
        }));
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: json,
        });
        await server.connect(transport);
        res.on("close", () => {
          void transport.close();
          void server.close();
        });
        await transport.handleRequest(req, res, body);
      });
      await new Promise<void>((resolve, reject) => {
        http.once("error", reject);
        http.listen(0, "127.0.0.1", resolve);
      });
      const url = `http://127.0.0.1:${(http.address() as { port: number }).port}/mcp`;
      const connection = createMcpConnection(
        { ...config(), transport: "http", url },
        { token: "fixture-token", env: {} },
        () => {},
      );
      cleanup.push(async () => {
        await connection.close();
        http.closeAllConnections();
        await new Promise<void>((resolve) => http.close(() => resolve()));
      });
      const signal = new AbortController().signal;
      await connection.connect(signal);
      expect(await connection.list(signal)).toHaveLength(1);
      expect(
        await connection.call("echo", { text: "http works" }, signal),
      ).toMatchObject({ content: [{ text: "http works" }] });
      expect(
        requests.every((r) => r.authorization === "Bearer fixture-token"),
      ).toBe(true);
      expect(requests[0].body.method).toBe("initialize");
      expect(
        requests.some((r) => r.body.method === "notifications/initialized"),
      ).toBe(true);
    },
  );
  it("bounds response bytes and enforces exact endpoints and redirect rejection", async () => {
    const fetchMock = vi.fn(
      async () => new Response("x".repeat(1024 * 1024 + 1)),
    );
    vi.stubGlobal("fetch", fetchMock);
    const bounded = boundedMcpFetch(
      "https://example.com/mcp",
      new AbortController().signal,
    );
    await expect(bounded("https://other.example/mcp")).rejects.toThrow();
    const response = await bounded("https://example.com/mcp");
    await expect(response.text()).rejects.toThrow();
    expect(fetchMock.mock.calls[0]).toEqual([
      "https://example.com/mcp",
      expect.objectContaining({ redirect: "error" }),
    ]);
  });
});

describe("conversation tool integration", () => {
  it("uses shared character context, awaits external tools and passes results back to the model", async () => {
    const h = harness();
    const alias = await h.ready("allow");
    h.store.update((d) => {
      d.settings.memory.autoRemember = false;
    });
    const runtime = new CompanionRuntime(
      h.store,
      () => "",
      "local-file",
      () => {},
    );
    runtime.tools = h.plugin;
    let second: any;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const body = JSON.parse(init.body);
        if (!body.messages.some((m: any) => m.role === "tool"))
          return Response.json({
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      id: "call1",
                      type: "function",
                      function: { name: alias, arguments: '{"text":"hi"}' },
                    },
                  ],
                },
              },
            ],
          });
        second = body;
        return Response.json({
          choices: [{ message: { content: "The tool returned hi." } }],
        });
      }),
    );
    expect(await runtime.send("Use the echo tool", [], "telegram")).toBe(
      "The tool returned hi.",
    );
    expect(h.connection.call).toHaveBeenCalledOnce();
    expect(
      second.messages.find((m: any) => m.role === "tool").content,
    ).toContain("untrustedToolResult");
    expect(h.store.data.messages.every((m) => m.channel === "telegram")).toBe(
      true,
    );
  });
  it("does not dispatch unadvertised tools or repeat failed operations within a turn", async () => {
    let round = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          choices: [
            {
              message:
                ++round === 4
                  ? { content: "Done" }
                  : {
                      tool_calls: [
                        {
                          id: `call${round}`,
                          type: "function",
                          function: {
                            name: round === 1 ? "unknown" : "known",
                            arguments: "{}",
                          },
                        },
                      ],
                    },
            },
          ],
        }),
      ),
    );
    const execute = vi.fn(async () => ({ error: "denied" }));
    await new OpenAICompatibleProvider().chatWithTools(
      defaultSettings.providers.llm,
      "",
      [],
      [{ type: "function", function: { name: "known" } }],
      execute,
      new AbortController().signal,
      () => {},
      () => {},
    );
    expect(execute).toHaveBeenCalledOnce();
  });
});
