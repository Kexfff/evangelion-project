import { it, expect } from "vitest";
import {
  itemEnchantments,
  itemFingerprint,
  itemCustomName,
} from "../electron/minecraft-items";
it("normalizes 26.1 structured enchantments, books and custom names", () => {
  const item: any = {
    name: "diamond_sword",
    durabilityUsed: 0,
    enchants: { enchantments: [{ id: 33, level: 2 }] },
    customName: { type: "string", value: "Eva's blade" },
  };
  expect(itemEnchantments(item)).toEqual([{ name: "id:33", lvl: 2 }]);
  expect(itemCustomName(item)).toContain("Eva's blade");
  expect(itemFingerprint(item)).not.toBe(
    itemFingerprint({ ...item, enchants: [] }),
  );
  item.name = "enchanted_book";
  item.enchants = [];
  item.componentMap = new Map([
    ["stored_enchantments", { data: { enchantments: [{ id: 40, level: 3 }] } }],
  ]);
  expect(itemEnchantments(item)).toEqual([{ name: "id:40", lvl: 3 }]);
});
it("preserves legacy metadata and handles empty values", () => {
  expect(itemEnchantments(null)).toEqual([]);
  expect(
    itemEnchantments({ enchants: [{ name: "sharpness", lvl: 3 }] } as any),
  ).toEqual([{ name: "sharpness", lvl: 3 }]);
  expect(itemCustomName({ customName: "Eva" } as any)).toBe("Eva");
});
