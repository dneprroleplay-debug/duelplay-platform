export const XP_BOOSTER_PLANS = {
  "2x24": { multiplier: 2, hours: 24, price: 2 },
  "2x72": { multiplier: 2, hours: 72, price: 5 },
  "3x24": { multiplier: 3, hours: 24, price: 4 },
} as const;

export type XPBoosterPlan = keyof typeof XP_BOOSTER_PLANS;

export function getXpBoosterPlan(value: unknown) {
  const key = String(value ?? "2x24") as XPBoosterPlan;
  return XP_BOOSTER_PLANS[key] ?? null;
}

export function boostedXpAmount(amount: number, multiplier: number) {
  const base = Math.max(0, Math.floor(Number(amount) || 0));
  const factor = Number(multiplier);
  if (!Number.isFinite(factor) || factor < 1) return base;
  return Math.max(0, Math.floor(base * factor));
}

export function boosterIsActive(startsAt: Date, endsAt: Date, now = new Date()) {
  return startsAt.getTime() <= now.getTime() && endsAt.getTime() > now.getTime();
}
