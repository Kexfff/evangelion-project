import mineflayer from "mineflayer";
import { pathfinder } from "mineflayer-pathfinder";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  JSONRPCMessageSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  minecraftConfigSchema,
  minecraftTools,
  type MinecraftLive,
} from "../src/shared/minecraft";
import { MinecraftEngine } from "./minecraft-engine";
import {
  minecraftPhysicsCompatibility,
  MinecraftPhysicsHealth,
} from "./minecraft-physics";

const config = minecraftConfigSchema.parse(JSON.parse(process.argv[2] ?? "{}"));
const parent = process.parentPort;
let engine: MinecraftEngine | undefined;
let physicsHealth: MinecraftPhysicsHealth | undefined;
let live: MinecraftLive = {
  status: "Connecting to Minecraft…",
  connected: false,
  players: [],
  inventory: [],
  nearby: [],
};
let closing = false;
let server: Server;
const state = () => {
  if (live.connected && engine) live = engine.observe();
  parent?.postMessage({ type: "state", data: live });
};
// Microsoft auth cache is memory-only: never reads/writes the user's .minecraft credentials.
const cache = new Map<string, unknown>();
const cacheFactory = ({ cacheName }: { cacheName: string }) => ({
  getCached: async () => cache.get(cacheName) ?? {},
  setCached: async (value: unknown) => {
    cache.set(cacheName, value);
  },
  setCachedPartial: async (value: Record<string, unknown>) => {
    cache.set(cacheName, {
      ...((cache.get(cacheName) as object) ?? {}),
      ...value,
    });
  },
});
const bot = mineflayer.createBot({
  host: config.host,
  port: config.port,
  version: config.version,
  username: config.username,
  auth: config.auth,
  hideErrors: true,
  respawn: false,
  profilesFolder: cacheFactory as unknown as string,
  onMsaCode: (code) => {
    live.status = "Sign in at microsoft.com/link. Login is session-only.";
    live.loginCode = code.user_code;
    state();
  },
  checkTimeoutInterval: 20000,
});
bot.loadPlugin(pathfinder);
bot.loadPlugin(minecraftPhysicsCompatibility);
bot.on("physicsTick", () => engine?.tick());
bot.on("spawn", () => {
  physicsHealth?.dispose();
  physicsHealth = new MinecraftPhysicsHealth(bot);
  engine?.stop("Respawned or changed dimension; previous job stopped.");
  engine?.dispose();
  if (!config.freePlay && bot.game.dimension !== config.dimension) {
    live.status =
      "Unexpected dimension. Disconnect and configure the correct world.";
    bot.quit();
    state();
    return;
  }
  engine = new MinecraftEngine(config, bot, state);
  engine.ready();
  live = engine.observe();
  state();
});
bot.on("death", () => {
  if (config.freePlay) {
    engine?.stop("Died; respawning without replaying the old job.");
    live.connected = false;
    live.status = "Respawning…";
    state();
    bot.respawn();
    return;
  }
  engine?.stop("Bot died; reconnect explicitly.");
  live.connected = false;
  live.status = "Bot died; no automatic respawn.";
  bot.quit();
  state();
});
bot.on("error", () => {
  live.connected = false;
  live.status =
    "Minecraft connection failed. Check host, version and account authentication.";
  engine?.stop("Connection failed.");
  state();
});
bot.on("kicked", () => {
  live.connected = false;
  live.status =
    "Server rejected or kicked the bot. Check authentication, allowlist and server rules.";
  engine?.stop("Kicked by server.");
  state();
});
bot.on("end", () => {
  live.connected = false;
  if (live.status === "Connected")
    live.status = "Disconnected. Reconnect explicitly; jobs are not replayed.";
  engine?.stop("Connection ended.");
  live.loginCode = undefined;
  state();
});
const timer = setInterval(() => {
  const problem = live.connected && physicsHealth?.problem();
  if (problem) {
    // Do not attempt to serialize NaN positions or leave an old green job alive.
    live = {
      connected: false,
      status: problem,
      players: [],
      inventory: [],
      nearby: [],
    };
    engine?.stop(problem);
    live.job = engine?.job;
    bot.quit();
  }
  engine?.tick();
  state();
}, 1000);
async function shutdown() {
  if (closing) return;
  closing = true;
  clearInterval(timer);
  physicsHealth?.dispose();
  engine?.stop("Adapter stopped.");
  engine?.dispose();
  bot.quit();
  await server?.close();
  setTimeout(() => process.exit(0), 100).unref();
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
const transport: Transport = parent
  ? {
      async start() {
        parent.on("message", ({ data }) => {
          if (data?.type === "permissions") {
            const updated = minecraftConfigSchema.parse(data.data);
            engine?.stop("Minecraft permissions changed.");
            Object.assign(config, {
              movement: updated.movement,
              chat: updated.chat,
              modifyBlocks: updated.modifyBlocks,
              navigationBlocks: updated.navigationBlocks,
              navigationDoors: updated.navigationDoors,
              operatorLookup: updated.operatorLookup,
              backgroundLookup: updated.backgroundLookup,
            });
            engine?.ready();
            state();
            return;
          }
          if (data?.type === "stop") {
            engine?.stop();
            state();
            return;
          }
          if (data?.type === "shutdown") {
            void shutdown();
            return;
          }
          if (data?.type !== "mcp" || JSON.stringify(data).length > 1024 * 1024)
            return;
          const parsed = JSONRPCMessageSchema.safeParse(data.data);
          if (parsed.success) transport.onmessage?.(parsed.data);
        });
      },
      async send(message) {
        parent.postMessage({ type: "mcp", data: message });
      },
      async close() {
        transport.onclose?.();
      },
    }
  : new StdioServerTransport();
server = new Server(
  { name: "evangelion-minecraft", version: "0.4.15" },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: JSON.parse(JSON.stringify(minecraftTools)),
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const data =
      request.params.name === "observe" && !live.connected
        ? live
        : request.params.name === "job_status"
          ? (engine?.job ?? { status: "idle" })
          : !engine || !live.connected
            ? (() => {
                throw new Error("Not connected to the world yet.");
              })()
            : await engine.call(
                request.params.name,
                request.params.arguments ?? {},
              );
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text:
            error instanceof Error
              ? error.message.slice(0, 300)
              : "Minecraft action failed.",
        },
      ],
    };
  }
});
void server.connect(transport);
