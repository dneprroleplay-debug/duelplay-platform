import { prisma } from "@/lib/prisma";

export const FEATURE_FLAG_KEYS = [
  "DUELS", "MATCHMAKING", "CASES", "TOURNAMENTS", "DUELPASS", "PRIME",
  "REFERRALS", "PROMOS", "STEAM_TRADE", "MAINTENANCE_MODE",
] as const;
export type FeatureFlagKey = typeof FEATURE_FLAG_KEYS[number];
export const FEATURE_FLAG_DEFAULTS: Record<FeatureFlagKey, boolean> = {
  DUELS: true, MATCHMAKING: true, CASES: true, TOURNAMENTS: false,
  DUELPASS: false, PRIME: false, REFERRALS: true, PROMOS: true,
  STEAM_TRADE: false, MAINTENANCE_MODE: false,
};
export function isFeatureFlagKey(value: unknown): value is FeatureFlagKey {
  return typeof value === "string" && (FEATURE_FLAG_KEYS as readonly string[]).includes(value);
}
export async function getFeatureFlag(key: string, fallback = true) {
  const row = await prisma.featureFlag.findUnique({ where: { key } });
  return row ? row.enabled : fallback;
}
export async function assertFeatureEnabled(key: FeatureFlagKey) {
  return getFeatureFlag(key, FEATURE_FLAG_DEFAULTS[key]);
}
export function validateFeatureFlagPayload(body: unknown) {
  if (!body || typeof body !== "object") return { ok: false as const, error: "INVALID_BODY" };
  const b = body as Record<string, unknown>;
  if (!isFeatureFlagKey(b.key)) return { ok: false as const, error: "INVALID_FEATURE_FLAG" };
  if (typeof b.enabled !== "boolean") return { ok: false as const, error: "INVALID_ENABLED" };
  return { ok: true as const, key: b.key, enabled: b.enabled };
}
