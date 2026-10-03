import {
  MINECRAFT_ID,
  minecraftTools,
  type MinecraftConfig,
} from "./minecraft";
import type { McpConfig, ToolPolicy } from "./mcp";
import { minecraftMovementTools } from "./minecraft-gameplay";

type Grant = { tool: string; fingerprint: string; policy: ToolPolicy };
export function isBundledMinecraft(config: McpConfig) {
  return (
    config.id === MINECRAFT_ID &&
    config.transport === "stdio" &&
    config.command === "bundled:minecraft" &&
    config.args.length === 0
  );
}
export function minecraftToolPolicy(name: string, grants: Grant[]): ToolPolicy {
  if (!minecraftTools.some((t) => t.name === name)) return "deny";
  // Explicit choices belong to stable bundled tool names, not changing descriptions.
  return grants.find((g) => g.tool === name)?.policy ?? "allow";
}
export function effectiveToolPolicy(
  config: McpConfig,
  grants: Grant[],
  tool: { name: string; fingerprint: string },
): ToolPolicy {
  if (isBundledMinecraft(config)) return minecraftToolPolicy(tool.name, grants);
  return (
    grants.find(
      (g) => g.tool === tool.name && g.fingerprint === tool.fingerprint,
    )?.policy ?? "deny"
  );
}
export function minecraftRuntimeConfig(
  config: MinecraftConfig,
  grants: Grant[],
): MinecraftConfig {
  const permitted = (name: string) =>
    minecraftToolPolicy(name, grants) !== "deny";
  return {
    ...config,
    freePlay: true,
    movement: minecraftMovementTools.some(permitted),
    chat: permitted("say_in_game"),
    backgroundLookup: minecraftToolPolicy("locate_player", grants) === "allow",
    modifyBlocks:
      permitted("collect_blocks") ||
      permitted("build_blocks") ||
      permitted("dig_block"),
    // A move/follow approval must not bypass a blocked/ask block-edit tool.
    navigationBlocks: [
      "collect_blocks",
      "build_blocks",
      "dig_block",
      "interact_block",
    ].every((name) => minecraftToolPolicy(name, grants) === "allow"),
  };
}
