import { DatabaseSync } from "node:sqlite";
import { chmodSync } from "node:fs";
import type { Database } from "./store";

export interface MemoryDocument {
  id: string;
  characterId: string;
  kind: "fact" | "episode" | "summary";
  text: string;
  date: string;
  sessionId?: string;
  messageId?: string;
  sourceIds?: string[];
}

/** Extractive digests: attributed quotations, not invented facts or LLM conclusions. */
export function memoryDocuments(db: Database): MemoryDocument[] {
  const docs: MemoryDocument[] = db.facts.map((f) => ({
    id: `fact:${f.id}`,
    characterId: f.characterId,
    kind: "fact",
    text: f.text,
    date: f.updatedAt,
  }));
  const sessions = new Map<string, typeof db.messages>();
  for (const summary of db.summaries)
    docs.push({
      id: `consolidated:${summary.id}`,
      kind: "summary",
      characterId: summary.characterId,
      sessionId: summary.sessionId,
      date: summary.createdAt,
      text: `Model-generated summary (verify against original conversation): ${summary.text}`,
      sourceIds: summary.sourceIds,
    });
  for (const m of db.messages) {
    const key = JSON.stringify([m.characterId, m.sessionId]);
    const group = sessions.get(key) ?? [];
    group.push(m);
    sessions.set(key, group);
  }
  for (const messages of sessions.values()) {
    messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.role !== "user") continue;
      const answer =
        messages[i + 1]?.role === "assistant" ? messages[i + 1] : undefined;
      const text = `User: ${m.content.slice(0, 2200)}${m.images?.length ? `\nAttached images: ${m.images.map((v) => v.name).join(", ")}` : ""}${answer ? `\nAssistant (not verified fact): ${answer.content.slice(0, 1200)}` : ""}`;
      docs.push({
        id: `message:${m.id}`,
        characterId: m.characterId,
        kind: "episode",
        text,
        date: m.createdAt,
        sessionId: m.sessionId,
        messageId: m.id,
      });
    }
    // Stable chunks consolidate older turns, including the older portion of a long active session.
    for (let i = 0; i + 12 <= messages.length; i += 12) {
      const chunk = messages.slice(i, i + 12),
        first = chunk[0];
      docs.push({
        id: `summary:${first.id}`,
        characterId: first.characterId,
        kind: "summary",
        sessionId: first.sessionId,
        date: chunk.at(-1)!.createdAt,
        sourceIds: chunk.map((m) => m.id),
        text: chunk
          .map(
            (m) =>
              `${m.role} [${m.createdAt.slice(0, 10)}]: ${m.content.slice(0, 280)}${m.images?.length ? " [image attached]" : ""}`,
          )
          .join("\n"),
      });
    }
  }
  return docs;
}

/** Rebuildable SQLite FTS/vector index. The validated store remains the source of truth. */
export class MemoryLibrary {
  readonly sql: DatabaseSync;
  constructor(file: string) {
    this.sql = new DatabaseSync(file);
    chmodSync(file, 0o600);
    this.sql.exec(`PRAGMA secure_delete=ON;
      CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY, character TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(id UNINDEXED, character UNINDEXED, text, tokenize='unicode61');
      CREATE TABLE IF NOT EXISTS vectors(id TEXT PRIMARY KEY, namespace TEXT NOT NULL, hash TEXT NOT NULL, vector TEXT NOT NULL);`);
  }
  sync(docs: MemoryDocument[]) {
    const old = new Map(
      (
        this.sql.prepare("SELECT id, payload FROM documents").all() as {
          id: string;
          payload: string;
        }[]
      ).map((d) => [d.id, d.payload]),
    );
    const put = this.sql.prepare(
      "INSERT OR REPLACE INTO documents VALUES (?, ?, ?)",
    );
    const add = this.sql.prepare("INSERT INTO search VALUES (?, ?, ?)");
    const remove = this.sql.prepare("DELETE FROM search WHERE id=?");
    this.sql.exec("BEGIN IMMEDIATE");
    try {
      for (const d of docs) {
        const payload = JSON.stringify(d);
        if (old.get(d.id) !== payload) {
          put.run(d.id, d.characterId, payload);
          remove.run(d.id);
          add.run(d.id, d.characterId, d.text);
        }
        old.delete(d.id);
      }
      for (const id of old.keys()) {
        this.sql.prepare("DELETE FROM documents WHERE id=?").run(id);
        remove.run(id);
        this.sql.prepare("DELETE FROM vectors WHERE id=?").run(id);
      }
      this.sql.exec("COMMIT");
    } catch (error) {
      this.sql.exec("ROLLBACK");
      throw error;
    }
  }
  search(characterId: string, query: string, limit = 100): string[] {
    const terms = query.match(/[\p{L}\p{N}]{2,}/gu)?.slice(0, 40) ?? [];
    if (!terms.length) return [];
    return (
      this.sql
        .prepare(
          "SELECT id FROM search WHERE search MATCH ? AND character=? ORDER BY rank LIMIT ?",
        )
        .all(terms.map((t) => `"${t}"`).join(" OR "), characterId, limit) as {
        id: string;
      }[]
    ).map((v) => v.id);
  }
  compact() {
    this.sql.exec("INSERT INTO search(search) VALUES('rebuild'); VACUUM;");
  }
}
