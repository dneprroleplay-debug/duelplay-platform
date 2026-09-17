export type WeightedCaseItem = { id: string; weight: number };

export function pickWeightedCaseItem<T extends WeightedCaseItem>(items: T[], roll: number): T {
  const weighted = items.filter((item) => Number.isInteger(item.weight) && item.weight > 0);
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) throw new Error("NO_CASE_ITEMS");
  if (!Number.isInteger(roll) || roll < 1 || roll > total) throw new Error("INVALID_ROLL");
  let cursor = 0;
  for (const item of weighted) {
    cursor += item.weight;
    if (roll <= cursor) return item;
  }
  return weighted[weighted.length - 1];
}

export function caseChancePercent(weight: number, items: WeightedCaseItem[]): number {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  return total > 0 && weight > 0 ? (weight / total) * 100 : 0;
}
