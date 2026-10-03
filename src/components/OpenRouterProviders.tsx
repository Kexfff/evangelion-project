import { useEffect, useRef, useState } from "react";
import { RefreshCw, Route } from "lucide-react";
import { bridge } from "../bridge";
import {
  openRouterModelSchema,
  type OpenRouterEndpoint,
} from "../shared/openrouter";

const price = (value?: string) =>
  value === undefined
    ? "—"
    : `$${(Number(value) * 1e6).toLocaleString(undefined, { maximumFractionDigits: 4 })}`;

/** Parent keys this component by base URL/model so late discoveries cannot cross models. */
export function OpenRouterProviders({
  model,
  selected,
  onChange,
}: {
  model: string;
  selected?: string[];
  onChange: (ids: string[] | undefined) => void;
}) {
  const [endpoints, setEndpoints] = useState<OpenRouterEndpoint[]>();
  const [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function fetchProviders() {
    setLoading(true);
    setError("");
    try {
      const rows = await bridge.listOpenRouterProviders(model);
      if (alive.current) setEndpoints(rows);
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "Could not fetch providers.");
    } finally {
      if (alive.current) setLoading(false);
    }
  }
  const rows = [
    ...(endpoints ?? []),
    ...(selected ?? [])
      .filter((id) => !endpoints?.some((row) => row.id === id))
      .map<OpenRouterEndpoint>((id) => ({ id, name: id, tools: false })),
  ];
  return (
    <section
      className="openrouter-routing"
      aria-label="OpenRouter provider routing"
    >
      <div className="openrouter-routing-heading">
        <div>
          <h3>
            <Route size={17} /> Model providers
          </h3>
          <p>Choose who runs this model on OpenRouter.</p>
        </div>
        <button
          className="button secondary"
          disabled={loading || !openRouterModelSchema.safeParse(model).success}
          onClick={() => void fetchProviders()}
        >
          <RefreshCw size={14} />
          {loading
            ? "Fetching providers…"
            : endpoints
              ? "Refresh providers"
              : "Fetch providers"}
        </button>
      </div>
      <label className="field">
        <span>OpenRouter routing</span>
        <select
          aria-label="OpenRouter routing"
          disabled={!openRouterModelSchema.safeParse(model).success}
          value={selected === undefined ? "auto" : "only"}
          onChange={(e) => onChange(e.target.value === "auto" ? undefined : [])}
        >
          <option value="auto">Automatic — any available provider</option>
          <option value="only">Only selected providers</option>
        </select>
      </label>
      <p className="openrouter-routing-note">
        {selected === undefined
          ? "Automatic routing is active. Select a provider below to restrict this model."
          : `${selected.length} selected · requests stay within this list. If none can serve the request, it fails instead of using another provider.`}{" "}
        Choices are saved separately for each model with Save changes.
      </p>
      {error && (
        <p className="error-notice" role="alert">
          {error}
        </p>
      )}
      {selected?.length === 0 && (
        <p className="error-notice" role="alert">
          Choose at least one provider before saving, or switch to automatic
          routing.
        </p>
      )}
      {rows.length > 0 && (
        <>
          <input
            aria-label="Search model providers"
            placeholder="Search providers or endpoint IDs…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="openrouter-endpoints">
            {rows
              .filter((r) =>
                `${r.name} ${r.id}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((row) => {
                const known = endpoints?.some((r) => r.id === row.id);
                return (
                  <label
                    key={row.id}
                    className="openrouter-endpoint"
                    data-selected={selected?.includes(row.id) || undefined}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Use ${row.id}`}
                      checked={selected?.includes(row.id) ?? false}
                      onChange={(e) =>
                        onChange(
                          e.target.checked
                            ? [...(selected ?? []), row.id]
                            : selected!.filter((id) => id !== row.id),
                        )
                      }
                    />
                    <div>
                      <strong>{row.name}</strong>
                      <code>{row.id}</code>
                      <small>
                        {known
                          ? `${row.tools ? "Tools advertised" : "Tools not advertised"} · Input ${price(row.inputPrice)} / Output ${price(row.outputPrice)} per 1M tokens`
                          : endpoints
                            ? "Saved selection · not in the latest catalog"
                            : "Saved selection · fetch to check catalog"}
                      </small>
                    </div>
                  </label>
                );
              })}
          </div>
          {!rows.some((r) =>
            `${r.name} ${r.id}`.toLowerCase().includes(search.toLowerCase()),
          ) && <p>No providers match your search.</p>}
        </>
      )}
      {endpoints?.length === 0 && (
        <p>
          No endpoints were listed for this model. Try refreshing later or
          choose a concrete model rather than a router/preset.
        </p>
      )}
      <p className="openrouter-routing-note">
        Catalog prices and capabilities can change; account restrictions still
        apply. Fetching the public catalog sends no API key or chat content.
      </p>
    </section>
  );
}
