import { useMemo } from "react";
import { Sparkles } from "lucide-react";
import type { Fact } from "../shared/schema";

// A bounded, local illustration — deliberately not a projection of embeddings.
// No providers, vectors, or additional personal data are needed to draw it.
export function MemoryConstellation({
  facts,
  selectedId,
  onSelect,
}: {
  facts: Fact[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const nodes = useMemo(
    () =>
      facts.slice(0, 36).map((fact, i, visible) => {
        const angle = i * 2.399963 + 0.35;
        const radius = Math.sqrt((i + 2) / (visible.length + 3));
        return {
          fact,
          x: 50 + Math.cos(angle) * radius * 41,
          y: 50 + Math.sin(angle) * radius * 37,
        };
      }),
    [facts],
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
          {nodes.map((node, i) => {
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
          Illustrative, not an embedding map.
          {facts.length > 36
            ? " Showing 36 recently updated memories."
            : facts.length
              ? " Select a star to explore."
              : " Add a memory to light the first star."}
        </p>
      </div>
    </div>
  );
}
