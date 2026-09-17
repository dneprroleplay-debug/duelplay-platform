export const PRIME_PLANS = {
  MONTH: { days: 30, price: 9.99, label: "30 days" },
  QUARTER: { days: 90, price: 24.99, label: "90 days" },
  YEAR: { days: 365, price: 79.99, label: "365 days" },
} as const;

export type PrimePlan = keyof typeof PRIME_PLANS;

export function getPrimePlan(value: unknown): PrimePlan | null {
  const plan = String(value ?? "").trim().toUpperCase() as PrimePlan;
  return plan in PRIME_PLANS ? plan : null;
}

export function isPrimeActive(endsAt: Date | string | null | undefined, now = new Date()): boolean {
  if (!endsAt) return false;
  return new Date(endsAt).getTime() > now.getTime();
}

export function primeStatus(endsAt: Date | string | null | undefined, now = new Date()) {
  const active = isPrimeActive(endsAt, now);
  const end = endsAt ? new Date(endsAt) : null;
  const remainingMs = active && end ? Math.max(0, end.getTime() - now.getTime()) : 0;
  return { active, endsAt: end, remainingMs };
}
