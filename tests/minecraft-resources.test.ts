import { describe, it, expect } from "vitest";
import { resourcePlan } from "../electron/minecraft-resources";

function fixture(inventory: { name: string; count: number }[] = []) {
  const names = [
    "oak_log",
    "oak_planks",
    "stick",
    "wooden_pickaxe",
    "iron_ingot",
    "iron_block",
  ];
  const recipes: Record<number, any[]> = {
    1: [
      {
        delta: [{ id: 0, count: -1 }],
        result: { count: 4 },
        requiresTable: false,
      },
    ],
    2: [
      {
        delta: [{ id: 1, count: -2 }],
        result: { count: 4 },
        requiresTable: false,
      },
    ],
    3: [
      {
        delta: [
          { id: 1, count: -3 },
          { id: 2, count: -2 },
        ],
        result: { count: 1 },
        requiresTable: true,
      },
    ],
    4: [
      {
        delta: [{ id: 5, count: -1 }],
        result: { count: 9 },
        requiresTable: false,
      },
    ],
    5: [
      {
        delta: [{ id: 4, count: -9 }],
        result: { count: 1 },
        requiresTable: true,
      },
    ],
  };
  return {
    inventory: { items: () => inventory },
    registry: {
      itemsByName: Object.fromEntries(names.map((name, id) => [name, { id }])),
      items: names.map((name) => ({ name })),
    },
    recipesAll: (id: number) => recipes[id] ?? [],
  } as any;
}
describe("Resource prerequisites", () => {
  it("accounts for shared ingredients, recipe quantities and leftovers in order", () => {
    const plan = resourcePlan(fixture(), "wooden_pickaxe", 1);
    expect(plan.missing).toEqual([{ item: "oak_log", count: 2 }]);
    expect(plan.steps.map((s) => s.item)).toEqual([
      "oak_planks",
      "oak_planks",
      "stick",
      "wooden_pickaxe",
    ]);
    expect(plan.requiresTable).toBe(true);
    expect(plan.limited).toBe(false);
  });
  it("uses carried stock exactly once and targets total stock, not extra gain", () => {
    const bot = fixture([
      { name: "oak_planks", count: 3 },
      { name: "oak_log", count: 1 },
    ]);
    expect(resourcePlan(bot, "wooden_pickaxe", 1).missing).toEqual([]);
    expect(resourcePlan(bot, "oak_planks", 3).steps).toEqual([]);
    expect(
      resourcePlan(
        fixture([{ name: "oak_planks", count: 3 }]),
        "wooden_pickaxe",
        1,
      ).missing,
    ).toEqual([{ item: "oak_log", count: 1 }]);
  });
  it("terminates reversible recipes and makes limitations explicit", () => {
    const plan = resourcePlan(fixture(), "iron_ingot", 1);
    expect(plan.limited).toBe(true);
    expect(plan.steps.length).toBeLessThanOrEqual(6);
    expect(plan.missing.length).toBeGreaterThan(0);
  });
  it("reports noncrafting acquisition as a leaf, without inventing smelting", () => {
    expect(resourcePlan(fixture(), "oak_log", 5).missing).toEqual([
      { item: "oak_log", count: 5 },
    ]);
  });
});
