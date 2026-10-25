import { useEffect, useRef, useState } from "react";
import { Cable, Check, Gamepad2, Send, ShieldAlert } from "lucide-react";
import type { Snapshot } from "../shared/schema";
import { MINECRAFT_ID } from "../shared/minecraft";
import { bridge } from "../bridge";
import { MinecraftSettings } from "./MinecraftSettings";
import { McpSettings } from "./McpSettings";
import { PluginSettings } from "./PluginSettings";

export function IntegrationSettings({ snapshot }: { snapshot: Snapshot }) {
  const pending = snapshot.mcp?.pending.length ?? 0;
  const pendingIds = snapshot.mcp?.pending.map((p) => p.id).join(",") ?? "";
  const [view, setView] = useState("minecraft");
  const previousPending = useRef("");
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (pendingIds && pendingIds !== previousPending.current) setView("mcp");
    previousPending.current = pendingIds;
  }, [pendingIds]);
  const servers =
    snapshot.mcp?.servers.filter((s) => s.config.id !== MINECRAFT_ID) ?? [];
  const choices = [
    {
      id: "minecraft",
      title: "Minecraft",
      subtitle: "Play together",
      icon: Gamepad2,
      status:
        snapshot.minecraft?.enabled === false
          ? "Plugin off"
          : snapshot.minecraft?.live.connected
            ? "In the world"
            : "Not connected",
      active: !!snapshot.minecraft?.live.connected,
    },
    {
      id: "mcp",
      title: "MCP connections",
      subtitle: "Tools & services",
      icon: Cable,
      status: pending
        ? `${pending} awaiting approval`
        : `${servers.length} connection${servers.length === 1 ? "" : "s"}`,
      active: servers.some((s) => s.status === "Connected"),
    },
    {
      id: "telegram",
      title: "Telegram",
      subtitle: "Stay in touch",
      icon: Send,
      status: snapshot.plugins?.status ?? "Not installed",
      active: snapshot.plugins?.status === "Connected",
    },
  ];
  return (
    <div className="integration-hub">
      {error && (
        <p className="error-notice" role="alert">
          {error}
        </p>
      )}
      {snapshot.mcp?.stopped && (
        <p className="integration-alert" role="status">
          <ShieldAlert size={16} /> Emergency stop is active. All MCP
          connections are disabled. Reconnect explicitly to resume.
        </p>
      )}
      <div className="integration-top">
        <nav className="integration-nav" aria-label="Integration sections">
          {choices.map(
            ({ id, title, subtitle, icon: Icon, status, active }) => (
              <button
                key={id}
                aria-label={title}
                aria-pressed={view === id}
                aria-controls={`integration-${id}`}
                className={`integration-choice ${id}`}
                onClick={() => setView(id)}
              >
                <span className="integration-icon">
                  <Icon size={21} />
                </span>
                <span className="integration-choice-copy">
                  <strong>{title}</strong>
                  <span>{subtitle}</span>
                  <small className={active ? "is-connected" : ""}>
                    <i />
                    {status}
                  </small>
                </span>
              </button>
            ),
          )}
        </nav>
        <button
          className="button integration-stop"
          disabled={stopping}
          onClick={async () => {
            setStopping(true);
            setError("");
            try {
              await bridge.stopTools();
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Could not stop tools.",
              );
            } finally {
              setStopping(false);
            }
          }}
        >
          <ShieldAlert size={15} />
          {stopping ? "Stopping tools…" : "Emergency stop tools"}
        </button>
      </div>
      <p className="integration-save-hint">
        <Check size={13} /> Each integration has its own Save button; permission
        changes apply right away.
      </p>
      <div id="integration-minecraft" hidden={view !== "minecraft"}>
        <MinecraftSettings
          data={snapshot.minecraft}
          mcp={snapshot.mcp}
          characterId={snapshot.settings.activeCharacterId}
        />
      </div>
      <div id="integration-mcp" hidden={view !== "mcp"}>
        <McpSettings
          data={snapshot.mcp}
          characterId={snapshot.settings.activeCharacterId}
        />
      </div>
      <div id="integration-telegram" hidden={view !== "telegram"}>
        <PluginSettings data={snapshot.plugins} />
      </div>
    </div>
  );
}
