import {
  approachLabels,
  type ApproachDiagnostic,
} from "../shared/minecraft-diagnostics";

export function MinecraftDiagnostics({
  entries,
}: {
  entries?: ApproachDiagnostic[];
}) {
  if (!entries?.length) return null;
  return (
    <details className="minecraft-diagnostics">
      <summary>Crafting-table approaches · {entries.length}</summary>
      <ol>
        {entries.map((d, i) => (
          <li key={`${d.startedAt}-${i}`}>
            <strong>
              ({d.position.x}, {d.position.y}, {d.position.z})
            </strong>
            <span>{approachLabels[d.outcome]}</span>
            <small>
              {(
                (d.outcome === "approaching"
                  ? Math.max(0, Date.now() - Date.parse(d.startedAt))
                  : d.elapsedMs) / 1000
              ).toFixed(1)}
              s · {new Date(d.startedAt).toLocaleTimeString()}
            </small>
          </li>
        ))}
      </ol>
      <p>
        These are observed approach results, not proof that a table is
        impossible to reach. Attempts do not retry uncertain crafting
        operations.
      </p>
    </details>
  );
}
