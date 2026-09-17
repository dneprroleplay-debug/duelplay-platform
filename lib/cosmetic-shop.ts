export const COSMETIC_TYPES = ["AVATAR", "FRAME", "BADGE", "BANNER", "TITLE", "PROFILE_THEME", "EMOTE", "SPRAY", "COSMETIC"] as const;
export type CosmeticType = typeof COSMETIC_TYPES[number];

export function normalizeCosmeticType(value: unknown): CosmeticType {
  const type = String(value ?? "COSMETIC").trim().toUpperCase();
  if (!COSMETIC_TYPES.includes(type as CosmeticType)) throw new Error("INVALID_COSMETIC_TYPE");
  return type as CosmeticType;
}

export function validateCosmeticPrice(value: unknown): number {
  const price = Number(value);
  if (!Number.isFinite(price) || price <= 0) throw new Error("INVALID_COSMETIC_PRICE");
  return Number(price.toFixed(4));
}

export function validateCosmeticMetadata(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_COSMETIC_METADATA");
  const metadata = value as Record<string, unknown>;
  const gameplayKeys = ["damage", "accuracy", "recoil", "armor", "health", "speed", "fireRate", "weaponStats", "statBonus", "multiplier"];
  if (gameplayKeys.some(key => key in metadata)) throw new Error("GAMEPLAY_COSMETIC_FORBIDDEN");
  return metadata;
}

export function scopedShopIdempotencyKey(userId: string, key: string): string {
  return `shop:${userId}:${key}`;
}
