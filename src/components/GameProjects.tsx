import { useState } from "react";
import { FolderKanban, Plus } from "lucide-react";
import { bridge } from "../bridge";
import type { MinecraftSnapshot } from "../shared/minecraft";
import { gameProjectInputSchema, type GameProject } from "../shared/game-goals";

export function GameProjects({ data }: { data?: MinecraftSnapshot }) {
  const [editing, setEditing] = useState<GameProject>();
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [targets, setTargets] = useState("oak_log 16\ncobblestone 32");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showArchive, setShowArchive] = useState(false);
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Project update failed.");
    } finally {
      setBusy(false);
    }
  }
  const input = (p: GameProject, status = p.status) => ({
    id: p.id,
    title: p.title,
    objective: p.objective,
    targets: p.targets,
    status,
  });
  return (
    <section className="game-goals game-projects">
      <div className="integration-section-title">
        <FolderKanban size={17} />
        <h3>World projects</h3>
        <span className="connection-badge">The bigger picture</span>
      </div>
      <p>
        Keep resource targets and a purpose for each project. Active projects
        guide independent play; saving does not start a goal or enable autonomy.
        Pausing a project excludes it from new activity selection, but does not
        stop a goal already running.
      </p>
      {error && (
        <p className="error-notice" role="alert">
          {error}
        </p>
      )}
      {!data?.live.connected && (
        <p>Join a world to view and edit its projects.</p>
      )}
      <div className="project-grid">
        {(data?.projects ?? [])
          .filter((p) => showArchive || p.status !== "archived")
          .map((p) => {
            const activeGoal = data?.goals?.some(
              (g) =>
                g.projectId === p.id &&
                ["running", "queued", "paused"].includes(g.status),
            );
            return (
              <article key={p.id} className="project-card">
                <div className="integration-section-title">
                  <h4>{p.title}</h4>
                  <span className="connection-badge">{p.status}</span>
                </div>
                <p>{p.objective}</p>
                <ul className="project-targets">
                  {p.targets.map((t) => {
                    const held =
                      data?.live.inventory
                        .filter((i) => i.name === t.item)
                        .reduce((n, i) => n + i.count, 0) ?? 0;
                    return (
                      <li key={t.item}>
                        <div>
                          <span>{t.item.replaceAll("_", " ")}</span>
                          <small>
                            {held} / {t.count}
                          </small>
                        </div>
                        <progress
                          aria-label={`${t.item} stock`}
                          value={Math.min(held, t.count)}
                          max={t.count}
                        />
                      </li>
                    );
                  })}
                </ul>
                <small>
                  Current carried stock, not reserved materials or chest
                  contents.
                </small>
                {p.lastOutcome && (
                  <p className="project-outcome">{p.lastOutcome}</p>
                )}
                {p.lastVerifiedAt && (
                  <small>
                    Targets last verified{" "}
                    {new Date(p.lastVerifiedAt).toLocaleString()}
                  </small>
                )}
                <div className="button-row">
                  <button
                    className="button primary"
                    disabled={
                      busy ||
                      !data?.live.connected ||
                      p.status !== "active" ||
                      activeGoal
                    }
                    onClick={() =>
                      void run(() =>
                        bridge.submitGameGoal({
                          objective: p.objective,
                          projectId: p.id,
                          completion: p.targets.map((t) => ({
                            kind: "inventory",
                            ...t,
                          })),
                        }),
                      )
                    }
                  >
                    {activeGoal ? "Goal in progress" : "Work on targets"}
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => {
                      setEditing(p);
                      setTitle(p.title);
                      setObjective(p.objective);
                      setTargets(
                        p.targets.map((t) => `${t.item} ${t.count}`).join("\n"),
                      );
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        bridge.saveGameProject(
                          input(p, p.status === "active" ? "paused" : "active"),
                        ),
                      )
                    }
                  >
                    {p.status === "active" ? "Pause project" : "Activate"}
                  </button>
                  {p.status !== "archived" && (
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          bridge.saveGameProject(input(p, "archived")),
                        )
                      }
                    >
                      Archive
                    </button>
                  )}
                </div>
              </article>
            );
          })}
      </div>
      <label className="toggle-row">
        <span>Show archived projects</span>
        <input
          type="checkbox"
          checked={showArchive}
          onChange={(e) => setShowArchive(e.target.checked)}
        />
      </label>
      <details
        className="integration-disclosure"
        open={editing ? true : undefined}
      >
        <summary>
          {editing ? `Edit ${editing.title}` : "New world project"}
        </summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const parsed = targets
                .trim()
                .split("\n")
                .map((line) => {
                  const match = /^\s*([a-z0-9_]+)\s+(\d+)\s*$/.exec(line);
                  if (!match)
                    throw new Error(
                      "Use one item ID and quantity per line, e.g. oak_log 16.",
                    );
                  return { item: match[1], count: Number(match[2]) };
                });
              await bridge.saveGameProject(
                gameProjectInputSchema.parse({
                  id: editing?.id,
                  title,
                  objective,
                  targets: parsed,
                  status: editing?.status ?? "active",
                }),
              );
              setEditing(undefined);
              setTitle("");
              setObjective("");
            });
          }}
        >
          <fieldset disabled={busy || !data?.live.connected}>
            <div className="form-grid">
              <label className="field">
                <span>Project title</span>
                <input
                  required
                  maxLength={120}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label className="field">
                <span>Purpose / next milestone</span>
                <input
                  required
                  maxLength={600}
                  value={objective}
                  onChange={(e) => setObjective(e.target.value)}
                />
              </label>
              <label className="field">
                <span>Resource targets (up to 8, one per line)</span>
                <textarea
                  required
                  rows={4}
                  value={targets}
                  onChange={(e) => setTargets(e.target.value)}
                />
              </label>
            </div>
            <div className="button-row">
              <button className="button primary">
                <Plus size={14} />
                Save project
              </button>
              {editing && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    setEditing(undefined);
                    setTitle("");
                    setObjective("");
                  }}
                >
                  Cancel edit
                </button>
              )}
            </div>
          </fieldset>
        </form>
      </details>
    </section>
  );
}
