import { useState } from "react";
import { Check, Search, Shield, CircleHelp } from "lucide-react";
import type { McpToolView, ToolPolicy } from "../shared/mcp";

const groups: Record<string, string[]> = {
  Explore: [
    "observe",
    "locate_player",
    "move_to",
    "follow_player",
    "find_blocks",
    "look_at",
  ],
  Survive: [
    "eat_food",
    "sleep",
    "wake",
    "attack_entity",
    "equip_item",
    "use_item",
  ],
  "Build & craft": [
    "dig_block",
    "collect_blocks",
    "build_blocks",
    "get_recipes",
    "craft_item",
    "interact_block",
  ],
  Inventory: ["inspect_inventory", "drop_items", "container", "furnace"],
  "Social & controls": [
    "say_in_game",
    "interact_entity",
    "job_status",
    "stop_action",
  ],
};
export function ToolPermissions({
  tools,
  scope,
  minecraft = false,
  disabled,
  onChange,
}: {
  tools: McpToolView[];
  scope: string;
  minecraft?: boolean;
  disabled: boolean;
  onChange: (tool: McpToolView, policy: ToolPolicy) => void;
}) {
  const [query, setQuery] = useState("");
  const [policy, setPolicy] = useState("all");
  const [group, setGroup] = useState("All tools");
  const visible = tools.filter(
    (t) =>
      (policy === "all" || t.policy === policy) &&
      (group === "All tools" || groups[group]?.includes(t.name)) &&
      `${t.name.replaceAll("_", " ")} ${t.name} ${t.description}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  return (
    <div className="tool-browser">
      <div
        className="permission-totals"
        aria-label={`${scope} permission summary`}
      >
        {(
          [
            ["allow", "Allowed", Check],
            ["ask", "Ask first", CircleHelp],
            ["deny", "Blocked", Shield],
          ] as const
        ).map(([value, label, Icon]) => (
          <span key={value} className={`permission-total ${value}`}>
            <Icon size={13} />
            {tools.filter((t) => t.policy === value).length} {label}
          </span>
        ))}
      </div>
      <div className="tool-toolbar">
        <label className="tool-search">
          <Search size={16} />
          <input
            aria-label={`Search ${scope} tools`}
            placeholder="Find a tool…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          aria-label={`Filter ${scope} tools by permission`}
          value={policy}
          onChange={(e) => setPolicy(e.target.value)}
        >
          <option value="all">All permissions</option>
          <option value="allow">Allowed</option>
          <option value="ask">Ask first</option>
          <option value="deny">Blocked</option>
        </select>
      </div>
      {minecraft && (
        <div className="tool-categories" aria-label="Minecraft tool categories">
          {["All tools", ...Object.keys(groups)].map((g) => (
            <button
              key={g}
              aria-pressed={group === g}
              onClick={() => setGroup(g)}
            >
              {g}
            </button>
          ))}
        </div>
      )}
      <p className="tool-result-count" role="status">
        {visible.length} of {tools.length} tools
      </p>
      <div
        className="tool-list"
        tabIndex={0}
        role="region"
        aria-label={`${scope} tool permissions`}
      >
        {visible.map((t) => (
          <article
            className={`permission-card policy-${t.policy}`}
            key={t.name}
          >
            <div className="permission-card-heading">
              <div>
                <h4>{t.name.replaceAll("_", " ")}</h4>
                <code>{t.name}</code>
              </div>
              <select
                aria-label={
                  minecraft
                    ? `Minecraft permission for ${t.name}`
                    : `Permission for ${scope}/${t.name}`
                }
                value={t.policy}
                disabled={disabled}
                onChange={(e) => onChange(t, e.target.value as ToolPolicy)}
              >
                <option value="deny">Blocked</option>
                <option value="ask">Ask every time</option>
                <option value="allow">Allow without asking</option>
              </select>
            </div>
            <p>{t.description?.split(". ")[0] || "No description provided."}</p>
            <details>
              <summary>
                {minecraft
                  ? "Tool details"
                  : "Description and input schema (untrusted server data)"}
              </summary>
              <p>{t.description || "No description provided."}</p>
              {!minecraft && (
                <pre>{JSON.stringify(t.inputSchema, null, 2)}</pre>
              )}
            </details>
          </article>
        ))}
        {!visible.length && (
          <div className="integration-empty">
            <Search size={24} />
            <h4>No matching tools</h4>
            <p>Try a different name or reset the filters.</p>
            <button
              className="button secondary"
              onClick={() => {
                setQuery("");
                setGroup("All tools");
                setPolicy("all");
              }}
            >
              Reset filters
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
