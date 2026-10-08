import type { Bot } from "mineflayer";

/** A bounded advisory recipe search. Never performs actions, assumes a drop,
 * or counts the same carried ingredient twice. Smelting/trading/loot remain
 * explicit acquisition leaves, not invented crafting recipes. */
export function resourcePlan(bot: Bot, item: string, count: number) {
  type Plan = {
    stock: Map<string, number>;
    missing: Map<string, number>;
    steps: {
      item: string;
      operations: number;
      output: number;
      requiresTable: boolean;
    }[];
    limited: boolean;
  };
  let nodes = 0;
  const clone = (p: Plan): Plan => ({
    stock: new Map(p.stock),
    missing: new Map(p.missing),
    steps: [...p.steps],
    limited: p.limited,
  });
  const score = (p: Plan) =>
    [...p.missing.values()].reduce((a, b) => a + b, 0) * 100 +
    p.steps.length +
    (p.limited ? 1000000 : 0);
  function need(name: string, amount: number, path: string[], p: Plan): Plan {
    const held = Math.min(p.stock.get(name) ?? 0, amount);
    p.stock.set(name, (p.stock.get(name) ?? 0) - held);
    amount -= held;
    if (!amount) return p;
    const id = bot.registry.itemsByName[name]?.id;
    const limited = path.length >= 6 || ++nodes > 256;
    const recipes =
      id === undefined || limited || path.includes(name)
        ? []
        : bot.recipesAll(id, null, true).slice(0, 12);
    let best: Plan | undefined;
    for (const r of recipes) {
      if (nodes > 256) break;
      if (r.result.count <= 0) continue;
      const ingredients = r.delta.filter((v) => v.count < 0);
      if (
        !ingredients.length ||
        ingredients.some((v) => !bot.registry.items[v.id])
      )
        continue;
      let next = clone(p);
      const operations = Math.ceil(amount / r.result.count);
      for (const ingredient of ingredients)
        next = need(
          bot.registry.items[ingredient.id].name,
          -ingredient.count * operations,
          [...path, name],
          next,
        );
      next.stock.set(
        name,
        (next.stock.get(name) ?? 0) + operations * r.result.count - amount,
      );
      next.steps.push({
        item: name,
        operations,
        output: r.result.count * operations,
        requiresTable: r.requiresTable,
      });
      if (!best || score(next) < score(best)) best = next;
    }
    if (best) return best;
    p.missing.set(name, (p.missing.get(name) ?? 0) + amount);
    p.limited ||= limited || path.includes(name);
    return p;
  }
  const stock = new Map<string, number>();
  for (const i of bot.inventory.items())
    stock.set(i.name, (stock.get(i.name) ?? 0) + i.count);
  const planned = need(item, count, [], {
    stock,
    missing: new Map(),
    steps: [],
    limited: false,
  });
  return {
    item,
    targetStock: count,
    missing: [...planned.missing].map(([item, count]) => ({ item, count })),
    steps: planned.steps,
    requiresTable: planned.steps.some((s) => s.requiresTable),
    limited: planned.limited,
    note: "Advisory crafting prerequisites using carried inventory, not chest stock. Missing leaves need gathering, smelting, trading or another recipe. Steps are ordered prerequisites, not authorized actions; split operations above 64. Recompute after changes. A table, suitable tools, reach and pickup still need verification. Search is bounded, not optimal.",
  };
}
