import { z } from "zod";
export const memoryMaintenanceSchema = z.object({
  historyDays: z.number().int().min(0).max(36500),
  taskDays: z.number().int().min(0).max(36500),
});
export type MemoryMaintenance = z.infer<typeof memoryMaintenanceSchema>;
export interface RecallResult {
  id: string;
  kind: string;
  text: string;
  date: string;
  score: number;
  reason: string;
}
export interface MemoryMap {
  nodes: { id: string; x: number; y: number }[];
  links: { from: string; to: string; similarity: number }[];
}
/** Centered PCA with cosine edges measured in original vector space, not screen distance. */
export function projectEmbeddings(
  items: { id: string; vector: number[] }[],
): MemoryMap {
  if (items.length < 2) return { nodes: [], links: [] };
  const dims = items[0].vector.length;
  const valid = items
    .filter((v) => v.vector.length === dims && v.vector.every(Number.isFinite))
    .slice(0, 80);
  if (valid.length < 2) return { nodes: [], links: [] };
  const normalized = valid.map(({ vector }) => {
    const norm = Math.hypot(...vector) || 1;
    return vector.map((x) => x / norm);
  });
  const mean = Array.from(
    { length: dims },
    (_, i) => normalized.reduce((s, v) => s + v[i], 0) / valid.length,
  );
  const rows = normalized.map((v) => v.map((x, i) => x - mean[i]));
  const dot = (a: number[], b: number[]) =>
    a.reduce((s, v, i) => s + v * b[i], 0);
  function axis(previous?: number[]) {
    let a = Array.from({ length: dims }, (_, i) =>
      Math.sin(i + (previous ? 2 : 1)),
    );
    for (let n = 0; n < 50; n++) {
      const projections = rows.map((r) => dot(r, a));
      const b = mean.map((_, i) =>
        rows.reduce((s, r, j) => s + r[i] * projections[j], 0),
      );
      if (previous) {
        const overlap = dot(b, previous);
        b.forEach((_, i) => (b[i] -= overlap * previous[i]));
      }
      const norm = Math.hypot(...b);
      if (norm < 1e-10) return b.map(() => 0);
      a = b.map((v) => v / norm);
    }
    return a;
  }
  const a = axis(),
    b = axis(a),
    xs = rows.map((r) => dot(r, a)),
    ys = rows.map((r) => dot(r, b));
  const extent = Math.max(...xs.map(Math.abs), ...ys.map(Math.abs), 1e-8);
  const links: MemoryMap["links"] = [];
  valid.forEach((v, i) => {
    const neighbors = valid
      .map((_, j) => ({ j, similarity: dot(normalized[i], normalized[j]) }))
      .filter((p) => p.j !== i && p.similarity >= 0.6)
      .sort((x, y) => y.similarity - x.similarity)
      .slice(0, 2);
    for (const p of neighbors)
      if (!links.some((l) => l.from === valid[p.j].id && l.to === v.id))
        links.push({ from: v.id, to: valid[p.j].id, similarity: p.similarity });
  });
  return {
    nodes: valid.map((v, i) => ({
      id: v.id,
      x: 50 + (xs[i] / extent) * 39,
      y: 50 + (ys[i] / extent) * 36,
    })),
    links,
  };
}
