import { TelegramPlugin } from "./telegram-plugin";
import { McpPlugin } from "./mcp-plugin";
import { PluginRegistry } from "./plugin-lifecycle";
import { MinecraftPlugin } from "./minecraft-plugin";
import { createMcpConnection } from "./mcp-connection";
import type { MinecraftFactory } from "./minecraft-transport";
import { MINECRAFT_ID } from "../src/shared/minecraft";
import type { CompanionRuntime } from "./runtime";
import type { CredentialVault } from "./credentials";
import type { TelegramAPI } from "./telegram-api";
import type { PluginAction, TelegramSettings } from "../src/shared/plugins";

/** Lifecycle orchestration knows neither channel transport nor MCP tool implementation. */
export class PluginHost {
  readonly registry = new PluginRegistry();
  readonly mcp: McpPlugin;
  readonly minecraft: MinecraftPlugin;
  private telegram: TelegramPlugin;
  private changing = false;
  constructor(
    private runtime: CompanionRuntime,
    vault: CredentialVault,
    transport?: (token: string) => TelegramAPI,
    minecraftFactory?: MinecraftFactory,
  ) {
    this.telegram = new TelegramPlugin(runtime, vault, transport);
    this.minecraft = new MinecraftPlugin(
      runtime.store,
      () => runtime.broadcast(),
      minecraftFactory,
    );
    this.mcp = new McpPlugin(
      runtime.store,
      vault,
      () => runtime.broadcast(),
      (config, secrets, invalidated) => {
        if (config.id !== MINECRAFT_ID)
          return createMcpConnection(config, secrets, invalidated);
        if (
          config.command !== "bundled:minecraft" ||
          config.characterId !== runtime.store.data.minecraft.config.characterId
        )
          throw new Error("Reconfigure the bundled Minecraft adapter first.");
        return this.minecraft.create(invalidated);
      },
    );
    this.registry.register(this.telegram);
    this.registry.register(this.mcp);
    runtime.tools = this.mcp;
    runtime.mcpSnapshot = () => this.mcp.snapshot();
    runtime.minecraftSnapshot = () => this.minecraft.snapshot();
    runtime.gameContext = () => this.minecraft.context();
  }
  snapshot() {
    return this.telegram.snapshot();
  }
  start() {
    return this.registry.start();
  }
  stop() {
    return this.registry.stop();
  }
  async exclusive<T>(operation: () => Promise<T>) {
    if (this.changing) throw new Error("Plugin operation in progress.");
    this.changing = true;
    try {
      return await operation();
    } finally {
      this.changing = false;
    }
  }
  configure(config: TelegramSettings, token?: string) {
    return this.exclusive(() => this.telegram.configure(config, token));
  }
  action(action: PluginAction) {
    return this.exclusive(() => this.telegram.action(action));
  }
  async withPaused<T>(operation: () => Promise<T>) {
    return this.exclusive(async () => {
      await this.stop();
      try {
        return await operation();
      } finally {
        await this.start();
      }
    });
  }
}
