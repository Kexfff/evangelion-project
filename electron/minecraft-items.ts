import type { Item } from "prismarine-item";

/** Prismarine Item's declared enchants/customName types still describe older
 * NBT items. Java 26.1 returns structured data components instead. */
export function itemEnchantments(
  item: Item | null | undefined,
): { name: string; lvl: number }[] {
  if (!item) return [];
  const components = (
    item as Item & { componentMap?: Map<string, { data: unknown }> }
  ).componentMap;
  const raw = (components?.get(
    item.name === "enchanted_book" ? "stored_enchantments" : "enchantments",
  )?.data ?? item.enchants) as unknown;
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && "enchantments" in raw
      ? (raw as { enchantments: unknown }).enchantments
      : [];
  if (!Array.isArray(list)) return [];
  return list
    .slice(0, 64)
    .flatMap((e) => {
      if (!e || typeof e !== "object") return [];
      const name =
        typeof e.name === "string"
          ? e.name
          : Number.isInteger(e.id)
            ? `id:${e.id}`
            : undefined;
      const lvl = e.lvl ?? e.level;
      return name && Number.isInteger(lvl) ? [{ name, lvl }] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
export function itemCustomName(item: Item) {
  const raw: unknown = item.customName;
  return raw == null
    ? null
    : typeof raw === "string"
      ? raw
      : JSON.stringify(raw);
}
export const itemFingerprint = (item: Item) =>
  JSON.stringify([
    item.name,
    item.durabilityUsed ?? 0,
    itemEnchantments(item),
    itemCustomName(item),
  ]);
