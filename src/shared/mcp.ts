import { z } from "zod";

export const mcpIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);
export const mcpConfigSchema = z
  .object({
    id: mcpIdSchema,
    name: z.string().trim().min(1).max(60),
    transport: z.enum(["stdio", "http"]),
    command: z.string().max(1000).default(""),
    args: z.array(z.string().max(2000)).max(30).default([]),
    url: z.string().max(2000).default(""),
    enabled: z.boolean().default(false),
    characterId: z.string().min(1).max(100),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (
      c.transport === "stdio" &&
      (!c.command.trim() || /[\r\n\0]/.test(c.command))
    )
      ctx.addIssue({
        code: "custom",
        message: "Specify an executable, not a shell command.",
      });
    if (c.transport === "http") {
      try {
        const u = new URL(c.url);
        if (
          u.username ||
          u.password ||
          u.hash ||
          u.search ||
          !(
            u.protocol === "https:" ||
            (u.protocol === "http:" &&
              ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname))
          )
        )
          throw new Error();
      } catch {
        ctx.addIssue({
          code: "custom",
          message:
            "Use HTTPS (or loopback HTTP), without credentials, query, or fragment.",
        });
      }
    }
  });
export const mcpSecretsSchema = z
  .object({
    token: z.string().max(8000).default(""),
    env: z
      .record(
        z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,99}$/),
        z.string().max(8000),
      )
      .default({}),
  })
  .strict()
  .refine(
    (s) => Object.keys(s.env).length <= 30,
    "Too many environment entries",
  );
export const toolPolicySchema = z.enum(["deny", "ask", "allow"]);
export const mcpGrantSchema = z.object({
  tool: z.string().min(1).max(128),
  fingerprint: z.string().length(64),
  policy: toolPolicySchema,
});
export const mcpAuditSchema = z.object({
  id: z.string(),
  at: z.string(),
  serverId: mcpIdSchema,
  tool: z.string().max(128),
  outcome: z.enum([
    "requested",
    "denied",
    "succeeded",
    "failed",
    "cancelled",
    "timeout",
  ]),
});
export const mcpStateSchema = z
  .object({
    servers: z
      .array(
        z.object({
          config: mcpConfigSchema,
          grants: z.array(mcpGrantSchema).max(64),
        }),
      )
      .max(12)
      .default([]),
    audit: z.array(mcpAuditSchema).max(200).default([]),
  })
  .refine(
    (s) => new Set(s.servers.map((v) => v.config.id)).size === s.servers.length,
    "Duplicate MCP server IDs",
  );
export type McpConfig = z.infer<typeof mcpConfigSchema>;
export type McpSecrets = z.infer<typeof mcpSecretsSchema>;
export type ToolPolicy = z.infer<typeof toolPolicySchema>;
export interface McpToolView {
  name: string;
  description: string;
  fingerprint: string;
  inputSchema: Record<string, unknown>;
  policy: ToolPolicy;
}
export interface McpSnapshot {
  stopped: boolean;
  servers: {
    config: McpConfig;
    status: string;
    hasSecrets: boolean;
    tools: McpToolView[];
  }[];
  pending: {
    id: string;
    serverId: string;
    tool: string;
    arguments: string;
    channel: string;
  }[];
  audit: z.infer<typeof mcpAuditSchema>[];
}
export interface ToolContext {
  characterId: string;
  sessionId: string;
  channel: "desktop" | "telegram";
}
export interface ToolProvider {
  definitions(): unknown[];
  execute(
    name: string,
    args: unknown,
    context: ToolContext,
    signal: AbortSignal,
  ): Promise<unknown>;
}
