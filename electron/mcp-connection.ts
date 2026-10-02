import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import type { McpConfig, McpSecrets } from "../src/shared/mcp";
import { boundedSchemaValidator } from "./mcp-schema";

export interface DiscoveredTool {
  name: string;
  description?: string;
  inputSchema: { type: "object"; [key: string]: unknown };
  [key: string]: unknown;
}
export interface McpConnection {
  connect(signal: AbortSignal): Promise<void>;
  list(signal: AbortSignal): Promise<DiscoveredTool[]>;
  call(
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown>;
  close(): Promise<void>;
}
export type ConnectionFactory = (
  config: McpConfig,
  secrets: McpSecrets,
  invalidated: () => void,
) => McpConnection;

/** Exact configured endpoint, no redirects or ambient provider credentials; bound JSON/SSE bytes. */
export function boundedMcpFetch(
  url: string,
  lifetime: AbortSignal,
): typeof fetch {
  return async (input, init) => {
    const target = input instanceof Request ? input.url : String(input);
    if (new URL(target).href !== new URL(url).href)
      throw new Error("MCP endpoint changed");
    const response = await fetch(input, {
      ...init,
      redirect: "error",
      signal: AbortSignal.any([
        lifetime,
        ...(init?.signal ? [init.signal] : []),
      ]),
    });
    if (!response.body) return response;
    const reader = response.body.getReader();
    let size = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) {
            controller.close();
            return;
          }
          size += next.value.byteLength;
          if (size > 1024 * 1024) {
            await reader.cancel();
            throw new Error("MCP response limit");
          }
          controller.enqueue(next.value);
        } catch {
          controller.error(new Error("MCP response unavailable"));
        }
      },
      cancel: () => reader.cancel(),
    });
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

export const createMcpConnection: ConnectionFactory = (
  config,
  secrets,
  invalidated,
) => {
  const lifetime = new AbortController();
  const client = new Client(
    { name: "evangelion-project", version: "0.4.0" },
    { capabilities: {}, jsonSchemaValidator: boundedSchemaValidator },
  );
  const transport =
    config.transport === "stdio"
      ? new StdioClientTransport({
          command: config.command,
          args: config.args,
          env: secrets.env,
          stderr: "pipe",
          maxBufferSize: 1024 * 1024,
        })
      : new StreamableHTTPClientTransport(new URL(config.url), {
          requestInit: {
            headers: secrets.token
              ? { Authorization: `Bearer ${secrets.token}` }
              : {},
          },
          fetch: boundedMcpFetch(config.url, lifetime.signal),
          reconnectionOptions: {
            maxRetries: 0,
            initialReconnectionDelay: 1000,
            maxReconnectionDelay: 1000,
            reconnectionDelayGrowFactor: 1,
          },
        });
  // Discard potentially secret stderr instead of forwarding it to application logs.
  if (transport instanceof StdioClientTransport)
    transport.stderr?.on("data", () => {});
  let closing = false;
  client.onclose = () => {
    if (!closing) invalidated();
  };
  client.onerror = () => {
    if (!closing) invalidated();
  };
  client.setNotificationHandler(ToolListChangedNotificationSchema, async () =>
    invalidated(),
  );
  const options = (signal: AbortSignal) => ({
    signal,
    timeout: 15000,
    maxTotalTimeout: 15000,
  });
  return {
    connect: (signal) => client.connect(transport, options(signal)),
    async list(signal) {
      const found: DiscoveredTool[] = [];
      let cursor: string | undefined;
      const cursors = new Set<string>();
      do {
        const page = await client.listTools(
          cursor ? { cursor } : undefined,
          options(signal),
        );
        found.push(...page.tools);
        if (found.length > 64) throw new Error("MCP tool limit");
        cursor = page.nextCursor;
        if (cursor && cursors.has(cursor))
          throw new Error("MCP pagination loop");
        if (cursor) cursors.add(cursor);
        if (cursors.size > 8) throw new Error("MCP page limit");
      } while (cursor);
      return found;
    },
    call: (name, args, signal) =>
      client.callTool({ name, arguments: args }, undefined, {
        signal,
        timeout: 30000,
        maxTotalTimeout: 30000,
      }),
    async close() {
      closing = true;
      lifetime.abort();
      await client.close();
    },
  };
};
