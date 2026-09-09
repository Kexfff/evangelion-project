/** Sprint 1 contracts only. No external code or MCP tools are executed yet. */
export type Capability =
  | "chat:send"
  | "memory:read"
  | "memory:write"
  | "notifications"
  | "desktop:read"
  | "desktop:control"
  | "game:control";
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: 1;
  capabilities: Capability[];
}
export interface CompanionEvent {
  type: "message:received" | "message:sent" | "session:started";
  characterId: string;
  text?: string;
}
export interface PluginContext {
  emit(event: CompanionEvent): void;
}
export interface CompanionPlugin {
  manifest: PluginManifest;
  activate(context: PluginContext): Promise<void>;
  deactivate(): Promise<void>;
}
export interface ScheduledTask {
  id: string;
  characterId: string;
  dueAt: string;
  intent: string;
  status: "pending" | "running" | "done" | "cancelled";
}
