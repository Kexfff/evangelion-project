import { TelegramPlugin } from "./telegram-plugin";
import { McpPlugin } from "./mcp-plugin";
import { PluginRegistry } from "./plugin-lifecycle";
import type { CompanionRuntime } from "./runtime";
import type { CredentialVault } from "./credentials";
import type { TelegramAPI } from "./telegram-api";
import type { PluginAction, TelegramSettings } from "../src/shared/plugins";

/** Lifecycle orchestration knows neither channel transport nor MCP tool implementation. */
export class PluginHost {
  readonly registry = new PluginRegistry();
  readonly mcp: McpPlugin;
  private telegram: TelegramPlugin;
  private changing = false;
  constructor(
    private runtime: CompanionRuntime,
    vault: CredentialVault,
    transport?: (token: string) => TelegramAPI,
  ) {
    this.telegram = new TelegramPlugin(runtime, vault, transport);
    this.mcp = new McpPlugin(runtime.store, vault, () => runtime.broadcast());
    this.registry.register(this.telegram);
    this.registry.register(this.mcp);
    runtime.tools = this.mcp;
    runtime.mcpSnapshot = () => this.mcp.snapshot();
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
