import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { Store, atomicWrite } from "./store";
import { OpenAICompatibleProvider } from "./providers";

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
    if (existsSync(this.file)) {
      try {
        this.entries = z
          .object({ version: z.literal(1), entries: z.array(entrySchema) })
          .parse(JSON.parse(readFileSync(this.file, "utf8"))).entries;
      } catch {
        /* This file is a rebuildable cache, never the source of memories. */
      }
    }
  }
  private documents() {
    return [
      ...this.store.data.facts.map((f) => ({
        id: `fact:${f.id}`,
        characterId: f.characterId,
        text: f.text,
      })),
      ...this.store.data.messages
        .filter((m) => m.role === "user")
        .map((m) => ({
          id: `message:${m.id}`,
          characterId: m.characterId,
          text: m.content.slice(0, 4000),
        })),
    ].map((d) => ({ ...d, hash: hash(`${d.characterId}:${d.text}`) }));
  }
  private namespace() {
    const p = this.store.data.settings.providers.embedding;
    return hash(`${p.baseUrl.replace(/\/+$/, "")}:${p.model}`);
  }
  private save() {
    atomicWrite(
      this.file,
      JSON.stringify({ version: 1, entries: this.entries }),
    );
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
    const missing = docs
      .filter(
        (d) =>
          !this.entries.some(
            (e) =>
              e.id === d.id && e.hash === d.hash && e.namespace === namespace,
          ),
      )
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
      batch.forEach((d, n) => {
        if (valid.get(d.id) !== d.hash) return;
        this.entries = this.entries.filter((e) => e.id !== d.id);
        this.entries.push({
          id: d.id,
          hash: d.hash,
          namespace,
          vector: vectors[n],
        });
      });
      this.save();
    }
    return {
      indexed: docs.filter((d) =>
        this.entries.some(
          (e) =>
            e.id === d.id && e.hash === d.hash && e.namespace === namespace,
        ),
      ).length,
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
