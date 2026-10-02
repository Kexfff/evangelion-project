/** Shared lifecycle only; channel and tool capabilities have separate interfaces. */
export interface ManagedPlugin {
  readonly id: string;
  readonly kind: "channel" | "tools";
  start(): Promise<void>;
  stop(): Promise<void>;
}

export class PluginRegistry {
  private entries = new Map<string, ManagedPlugin>();
  register(plugin: ManagedPlugin) {
    if (this.entries.has(plugin.id)) throw new Error("Duplicate plugin ID");
    this.entries.set(plugin.id, plugin);
  }
  async start() {
    await Promise.allSettled([...this.entries.values()].map((p) => p.start()));
  }
  async stop() {
    await Promise.allSettled([...this.entries.values()].map((p) => p.stop()));
  }
}
