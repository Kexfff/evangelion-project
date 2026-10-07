import { utilityProcess, type UtilityProcess } from "electron";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { JSONRPCMessageSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { boundedSchemaValidator } from "./mcp-schema";
import {
  minecraftLiveSchema,
  type MinecraftConfig,
  type MinecraftLive,
} from "../src/shared/minecraft";
import type { McpConnection } from "./mcp-connection";

export interface MinecraftConnection extends McpConnection {
  stopAction(): void;
  updatePermissions?(config: MinecraftConfig): void;
}
export type MinecraftFactory = (
  config: MinecraftConfig,
  onState: (state: MinecraftLive) => void,
  invalidated: (reason?: string) => void,
) => MinecraftConnection;
export function minecraftFactory(workerPath: string): MinecraftFactory {
  return (config, onState, invalidated) => {
    let child: UtilityProcess | undefined;
    let closing = false;
    let failed = false;
    let lastState = Date.now();
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const fail = (reason: string) => {
      if (closing || failed) return;
      failed = true;
      clearInterval(heartbeat);
      invalidated(reason);
      child?.kill();
    };
    const client = new Client(
      { name: "evangelion-project", version: "0.4.16" },
      { capabilities: {}, jsonSchemaValidator: boundedSchemaValidator },
    );
    const transport: Transport = {
      async start() {
        child = utilityProcess.fork(workerPath, [JSON.stringify(config)], {
          stdio: "pipe",
          serviceName: "Minecraft companion",
          execArgv: ["--max-old-space-size=512"],
          env: Object.fromEntries(
            Object.entries(process.env).filter(
              ([key, value]) =>
                value !== undefined &&
                [
                  "PATH",
                  "HOME",
                  "USERPROFILE",
                  "SYSTEMROOT",
                  "TEMP",
                  "TMP",
                  "LANG",
                ].includes(key),
            ),
          ),
        });
        child.stdout?.on("data", () => {});
        child.stderr?.on("data", () => {});
        lastState = Date.now();
        heartbeat = setInterval(() => {
          if (Date.now() - lastState > 10000)
            fail(
              "Minecraft worker stopped responding for 10 seconds. Reconnect Eva; the job was not replayed.",
            );
        }, 1000);
        heartbeat.unref();
        child.on("message", (message) => {
          if (closing || failed) return;
          if (!message || JSON.stringify(message).length > 1024 * 1024) {
            fail("Minecraft worker sent an invalid update. Reconnect Eva.");
            return;
          }
          if (message.type === "state") {
            const parsed = minecraftLiveSchema.safeParse(message.data);
            if (parsed.success) {
              lastState = Date.now();
              onState(parsed.data);
            } else
              fail(
                "Minecraft worker sent invalid world coordinates or state. Reconnect Eva.",
              );
            return;
          }
          if (message.type === "mcp") {
            const parsed = JSONRPCMessageSchema.safeParse(message.data);
            if (parsed.success) transport.onmessage?.(parsed.data);
          }
        });
        child.on("exit", () => {
          clearInterval(heartbeat);
          transport.onclose?.();
          if (!closing && !failed) invalidated();
        });
      },
      async send(data) {
        if (!child) throw new Error("Minecraft process unavailable.");
        child.postMessage({ type: "mcp", data });
      },
      async close() {
        closing = true;
        clearInterval(heartbeat);
        const process = child;
        child = undefined;
        if (process)
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              process.kill();
              resolve();
            }, 1000);
            process.once("exit", () => {
              clearTimeout(timer);
              resolve();
            });
            process.postMessage({ type: "shutdown" });
          });
        transport.onclose?.();
      },
    };
    client.onerror = () => {
      if (!closing && !failed) invalidated();
    };
    return {
      connect: (signal) =>
        client.connect(transport, { signal, timeout: 15000 }),
      list: async (signal) =>
        (await client.listTools(undefined, { signal, timeout: 15000 })).tools,
      call: (name, args, signal) =>
        client.callTool({ name, arguments: args }, undefined, {
          signal,
          timeout: 15000,
        }),
      stopAction: () => child?.postMessage({ type: "stop" }),
      updatePermissions: (config) =>
        child?.postMessage({ type: "permissions", data: config }),
      close: () => client.close(),
    };
  };
}
