import { useMemo } from "react";
import { Sparkles } from "lucide-react";
import type { Fact } from "../shared/schema";
import type { MemoryMap } from "../shared/memory-tools";

// A bounded, local illustration — deliberately not a projection of embeddings.
// No providers, vectors, or additional personal data are needed to draw it.
export function MemoryConstellation({
  facts,
  selectedId,
  onSelect,
  projection,
}: {
  facts: Fact[];
  selectedId?: string;
  onSelect: (id: string) => void;
  projection?: MemoryMap;
}) {
  const nodes = useMemo(
    () =>
      (projection
        ? facts.filter((f) => projection.nodes.some((n) => n.id === f.id))
        : facts.slice(0, 36)
      ).map((fact, i, visible) => {
        const point = projection?.nodes.find((n) => n.id === fact.id);
        const angle = i * 2.399963 + 0.35;
        const radius = Math.sqrt((i + 2) / (visible.length + 3));
        return {
          fact,
          x: point?.x ?? 50 + Math.cos(angle) * radius * 41,
          y: point?.y ?? 50 + Math.sin(angle) * radius * 37,
        };
      }),
    [facts, projection],
  );
  return (
    <div className="memory-cosmos">
      <div className="cosmos-label">
        <Sparkles size={13} /> MEMORY CONSTELLATION
      </div>
      <div
        className="constellation-stage"
        role="group"
        aria-label="Memory constellation"
      >
        <div className="constellation-haze" aria-hidden="true" />
        <svg
          className="constellation-lines"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <ellipse
            cx="50"
            cy="50"
            rx="43"
            ry="39"
            className="constellation-orbit"
          />
          <ellipse
            cx="50"
            cy="50"
            rx="28"
            ry="25"
            className="constellation-orbit"
          />
          {projection?.links.map((link) => {
            const a = nodes.find((n) => n.fact.id === link.from),
              b = nodes.find((n) => n.fact.id === link.to);
            return a && b ? (
              <line
                key={`${link.from}:${link.to}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                className={
                  a.fact.id === selectedId || b.fact.id === selectedId
                    ? "is-lit"
                    : ""
                }
              >
                <title>Cosine similarity: {link.similarity.toFixed(2)}</title>
              </line>
            ) : null;
          })}
          {!projection &&
            nodes.map((node, i) => {
              const next = nodes[i + 3];
              return (
                next && (
                  <line
                    key={node.fact.id}
                    x1={node.x}
                    y1={node.y}
                    x2={next.x}
                    y2={next.y}
                    className={
                      node.fact.id === selectedId || next.fact.id === selectedId
                        ? "is-lit"
                        : ""
                    }
                  />
                )
              );
            })}
          {Array.from({ length: 32 }, (_, i) => (
            <circle
              key={i}
              cx={(i * 29 + 3) % 100}
              cy={(i * 43 + 11) % 100}
              r={i % 4 === 0 ? 0.25 : 0.13}
              className="constellation-dust"
            />
          ))}
        </svg>
        {nodes.map(({ fact, x, y }) => (
          <button
            key={fact.id}
            className={`memory-star ${fact.source} ${fact.id === selectedId ? "selected" : ""}`}
            style={{ left: `${x}%`, top: `${y}%` }}
            aria-label={`Preview memory: ${fact.text}`}
            aria-pressed={fact.id === selectedId}
            title={fact.text}
            onClick={() => onSelect(fact.id)}
          >
            <span />
          </button>
        ))}
        {!facts.length && (
          <div className="constellation-seed">
            <Sparkles size={28} />
            <span>A little universe, waiting to grow.</span>
          </div>
        )}
      </div>
      <div className="constellation-caption">
        <div className="memory-legend">
          <span>
            <i /> Added by you
          </span>
          <span>
            <i /> From conversation
          </span>
        </div>
        <p>
          {projection
            ? `PCA projection · ${nodes.length} indexed facts · cosine links ≥ 0.60.`
            : "Illustrative, not an embedding map."}
          {!projection && facts.length > 36
            ? " Showing 36 recently updated memories."
            : facts.length
              ? " Select a star to explore."
              : " Add a memory to light the first star."}
        </p>
      </div>
    </div>
  );
}
