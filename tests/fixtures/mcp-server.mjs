import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "eva-test-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "echo",
      description: "Echo fixture text",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string", maxLength: 100 } },
        required: ["text"],
        additionalProperties: false,
      },
    },
    {
      name: "wait",
      description: "Wait for cancellation",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  ],
}));
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  if (request.params.name === "wait")
    await new Promise((resolve) => {
      if (extra.signal.aborted) return resolve();
      extra.signal.addEventListener("abort", resolve, { once: true });
    });
  return {
    content: [
      { type: "text", text: request.params.arguments?.text ?? "cancelled" },
    ],
    structuredContent: {
      envInjected: process.env.MCP_FIXTURE_KEY === "fixture-secret",
    },
  };
});
await server.connect(new StdioServerTransport());
