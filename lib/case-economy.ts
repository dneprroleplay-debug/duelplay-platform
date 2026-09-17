import { Prisma } from "@prisma/client";

export const CASE_MAX_PRICE = 100_000;
export const CASE_MAX_ITEM_VALUE = 1_000_000;
export const CASE_MAX_ITEM_WEIGHT = 1_000_000;
export const CASE_MAX_TOTAL_WEIGHT = 10_000_000;
export const CASE_MAX_RTP = 0.971;
export const CASE_MIN_HOUSE_EDGE = 1 - CASE_MAX_RTP;

export type CaseEconomyItem = {
  value: number | Prisma.Decimal;
  weight: number;
};

export function calculateCaseEconomy(price: number, items: CaseEconomyItem[]) {
  const safePrice = Number(price);
  const normalized = items.map((item) => ({
    value: Number(item.value),
    weight: Number(item.weight),
  }));
  const totalWeight = normalized.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  const expectedValue = totalWeight > 0
    ? normalized.reduce((sum, item) => sum + Math.max(0, item.weight) * Math.max(0, item.value), 0) / totalWeight
    : 0;
  const rtp = safePrice > 0 ? expectedValue / safePrice : 0;
  return { price: safePrice, totalWeight, expectedValue, rtp, houseEdge: safePrice > 0 ? 1 - rtp : 0 };
}

export function assertCaseEconomy(price: number, items: CaseEconomyItem[]) {
  const economy = calculateCaseEconomy(price, items);
  if (!Number.isFinite(economy.price) || economy.price <= 0 || economy.price > CASE_MAX_PRICE) throw new Error("INVALID_CASE_PRICE");
  if (!items.length) throw new Error("CASE_EMPTY");
  if (!Number.isSafeInteger(economy.totalWeight) || economy.totalWeight <= 0 || economy.totalWeight > CASE_MAX_TOTAL_WEIGHT) throw new Error("INVALID_CASE_WEIGHT");
  for (const item of items) {
    const value = Number(item.value);
    const weight = Number(item.weight);
    if (!Number.isFinite(value) || value < 0 || value > CASE_MAX_ITEM_VALUE) throw new Error("INVALID_CASE_ITEM_VALUE");
    if (!Number.isSafeInteger(weight) || weight < 1 || weight > CASE_MAX_ITEM_WEIGHT) throw new Error("INVALID_CASE_ITEM_WEIGHT");
  }
  if (!Number.isFinite(economy.expectedValue) || economy.expectedValue > economy.price * CASE_MAX_RTP + 1e-9) throw new Error("CASE_RTP_TOO_HIGH");
  if (!Number.isFinite(economy.houseEdge) || economy.houseEdge < CASE_MIN_HOUSE_EDGE - 1e-9) throw new Error("CASE_HOUSE_EDGE_TOO_LOW");
  return economy;
}
