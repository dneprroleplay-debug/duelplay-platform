export const CASE_RARITIES = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"] as const;
export type CaseRarity = (typeof CASE_RARITIES)[number];

const aliases: Record<string, CaseRarity> = {
  common: "Common", uncommon: "Uncommon", rare: "Rare", epic: "Epic",
  legendary: "Legendary", mythic: "Mythic", myth: "Mythic",
};

export function normalizeCaseRarity(value: unknown): CaseRarity {
  const key = String(value ?? "").trim().toLowerCase();
  const rarity = aliases[key];
  if (!rarity) throw new Error("INVALID_RARITY");
  return rarity;
}

export function rarityChancePercent(rarity: string, items: Array<{ rarity: string; weight: number }>): number {
  const total = items.reduce((sum, item) => sum + Math.max(0, Number(item.weight) || 0), 0);
  if (!total) return 0;
  const weight = items.filter((item) => normalizeCaseRarity(item.rarity) === rarity)
    .reduce((sum, item) => sum + Math.max(0, Number(item.weight) || 0), 0);
  return (weight / total) * 100;
}
