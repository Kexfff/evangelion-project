import { createHash } from "node:crypto";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { Store } from "./store";
import { OpenAICompatibleProvider } from "./providers";
import { memoryDocuments } from "./memory-library";
import { projectEmbeddings } from "../src/shared/memory-tools";

const entrySchema = z.object({
  id: z.string(),
  namespace: z.string(),
  hash: z.string(),
  vector: z.array(z.number().finite()).min(1).max(16384),
});
type Entry = z.infer<typeof entrySchema>;
export function cosine(a: number[], b: number[]) {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] ** 2;
    bb += b[i] ** 2;
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export class SemanticMemory {
  private entries: Entry[] = [];
  private file: string;
  constructor(
    private store: Store,
    private provider: OpenAICompatibleProvider,
    private key: () => string,
  ) {
    this.file = path.join(path.dirname(store.file), "memory-vectors.json");
    let invalid = false;
    for (const row of store.library.sql
      .prepare("SELECT * FROM vectors")
      .all()) {
      try {
        this.entries.push(
          entrySchema.parse({ ...row, vector: JSON.parse(String(row.vector)) }),
        );
      } catch {
        invalid = true; /* Invalid derived entries can be safely re-indexed. */
      }
    }
    if (invalid) this.save();
    if (existsSync(this.file)) {
      try {
        const legacy = z
          .object({ version: z.literal(1), entries: z.array(entrySchema) })
          .parse(JSON.parse(readFileSync(this.file, "utf8"))).entries;
        if (!this.entries.length) this.entries = legacy;
      } catch {
        /* This file is a rebuildable cache, never the source of memories. */
      }
      this.save();
      unlinkSync(this.file);
    }
  }
  projection() {
    this.prune();
    const ids = new Set(
      this.store.data.facts
        .filter((f) => f.characterId === this.store.characterId)
        .map((f) => `fact:${f.id}`),
    );
    return projectEmbeddings(
      this.entries
        .filter((e) => ids.has(e.id))
        .map((e) => ({ id: e.id.slice(5), vector: e.vector })),
    );
  }
  private documents() {
    return memoryDocuments(this.store.data).map((d) => ({
      ...d,
      hash: hash(`${d.characterId}:${d.text}`),
    }));
  }
  private namespace() {
    const p = this.store.data.settings.providers.embedding;
    return hash(`${p.baseUrl.replace(/\/+$/, "")}:${p.model}`);
  }
  private save() {
    const sql = this.store.library.sql;
    const old = new Map(
      (
        sql.prepare("SELECT id, namespace, hash FROM vectors").all() as {
          id: string;
          namespace: string;
          hash: string;
        }[]
      ).map((e) => [e.id, e]),
    );
    sql.exec("BEGIN IMMEDIATE");
    try {
      const insert = sql.prepare(
        "INSERT OR REPLACE INTO vectors VALUES (?, ?, ?, ?)",
      );
      for (const e of this.entries) {
        const previous = old.get(e.id);
        if (previous?.namespace !== e.namespace || previous?.hash !== e.hash)
          insert.run(e.id, e.namespace, e.hash, JSON.stringify(e.vector));
        old.delete(e.id);
      }
      const remove = sql.prepare("DELETE FROM vectors WHERE id=?");
      for (const id of old.keys()) remove.run(id);
      sql.exec("COMMIT");
    } catch (error) {
      sql.exec("ROLLBACK");
      throw error;
    }
  }
  prune() {
    const valid = new Map(this.documents().map((d) => [d.id, d.hash]));
    const next = this.entries.filter(
      (e) => valid.get(e.id) === e.hash && e.namespace === this.namespace(),
    );
    if (next.length !== this.entries.length) {
      this.entries = next;
      this.save();
    }
  }
  private async index(
    characterId: string,
    limit: number,
    signal?: AbortSignal,
  ) {
    this.prune();
    const namespace = this.namespace();
    const docs = this.documents().filter((d) => d.characterId === characterId);
    const cached = new Map(
      this.entries
        .filter((e) => e.namespace === namespace)
        .map((e) => [e.id, e.hash]),
    );
    const missing = docs
      .filter((d) => cached.get(d.id) !== d.hash)
      .slice(0, limit);
    for (let i = 0; i < missing.length; i += 32) {
      signal?.throwIfAborted();
      const batch = missing.slice(i, i + 32);
      const vectors = await this.provider.embed(
        this.store.data.settings.providers.embedding,
        this.key(),
        batch.map((d) => d.text),
        signal,
      );
      signal?.throwIfAborted();
      if (namespace !== this.namespace())
        throw new Error(
          "Embedding configuration changed. Rebuild with the new model.",
        );
      const valid = new Map(this.documents().map((d) => [d.id, d.hash]));
      if (
        vectors.length !== batch.length ||
        vectors.some(
          (v) =>
            !Array.isArray(v) ||
            !v.length ||
            v.some((x) => !Number.isFinite(x)),
        )
      )
        throw new Error("Embedding provider returned incomplete vectors.");
      batch.forEach((d, n) => {
        if (valid.get(d.id) !== d.hash) return;
        this.entries = this.entries.filter((e) => e.id !== d.id);
        this.entries.push({
          id: d.id,
          hash: d.hash,
          namespace,
          vector: vectors[n],
        });
        cached.set(d.id, d.hash);
      });
      this.save();
    }
    return {
      indexed: docs.filter((d) => cached.get(d.id) === d.hash).length,
      total: docs.length,
    };
  }
  async reindex(signal?: AbortSignal) {
    return this.index(this.store.characterId, Infinity, signal);
  }
  async recall(text: string, signal?: AbortSignal) {
    const characterId = this.store.characterId;
    const namespace = this.namespace();
    // Incremental indexing bounds each turn's additional cost; explicit rebuild handles large archives.
    await this.index(characterId, 32, signal);
    const [query] = await this.provider.embed(
      this.store.data.settings.providers.embedding,
      this.key(),
      [text.slice(0, 4000)],
      signal,
    );
    signal?.throwIfAborted();
    const valid = new Map(
      this.documents()
        .filter((d) => d.characterId === characterId)
        .map((d) => [d.id, d.hash]),
    );
    return new Map(
      this.entries
        .filter((e) => e.namespace === namespace && valid.get(e.id) === e.hash)
        .map((e) => [e.id, cosine(query, e.vector)]),
    );
  }
}
