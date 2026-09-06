/**
 * DuelPlay monetization safety boundary.
 * Purchases may unlock progression, convenience, access, or cosmetics,
 * but must never alter ranked gameplay outcomes or player combat stats.
 */
export const MONETIZATION_TRANSACTION_TYPES = [
  "CASE_OPEN",
  "COSMETIC_PURCHASE",
  "PRIME_PURCHASE",
  "DUELPASS_PURCHASE",
  "EVENTPASS_PURCHASE",
  "XP_BOOSTER_PURCHASE",
  "TOURNAMENT_ENTRY",
] as const;

export const PAY_TO_WIN_FORBIDDEN_KEYS = [
  "damage",
  "accuracy",
  "recoil",
  "armor",
  "health",
  "speed",
  "fireRate",
  "weaponStats",
  "statBonus",
  "multiplier",
  "rating",
  "ratingDelta",
  "stake",
  "betAmount",
  "weaponModifier",
] as const;

const FORBIDDEN = new Set(PAY_TO_WIN_FORBIDDEN_KEYS.map((key) => key.toLowerCase()));

/** Validate reward payloads recursively so nested premium/free rewards cannot smuggle gameplay modifiers. */
export function assertNonGameplayReward(value: unknown): void {
  const visit = (node: unknown, path: string): void => {
    if (node == null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (FORBIDDEN.has(key.toLowerCase())) throw new Error(`PAY_TO_WIN_FORBIDDEN:${path ? `${path}.` : ""}${key}`);
      visit(child, path ? `${path}.${key}` : key);
    }
  };
  visit(value, "");
}

export function isMonetizationTransactionType(value: unknown): boolean {
  return MONETIZATION_TRANSACTION_TYPES.includes(value as typeof MONETIZATION_TRANSACTION_TYPES[number]);
}
