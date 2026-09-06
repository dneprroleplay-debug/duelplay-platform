export const DUEL_MODES = [
  { id: "SOLO_1V1", label: "Classic 1v1", description: "Standard CS2 duel.", weaponModifier: null },
  { id: "AWP_ONLY", label: "AWP Only", description: "AWP only.", weaponModifier: "AWP_ONLY" },
  { id: "DEAGLE_ONLY", label: "Deagle Only", description: "Desert Eagle only.", weaponModifier: "DEAGLE_ONLY" },
  { id: "KNIFE_ONLY", label: "Knife Only", description: "Knife only.", weaponModifier: "KNIFE_ONLY" },
  { id: "HEADSHOT_ONLY", label: "Headshot Only", description: "Headshots only.", weaponModifier: "HEADSHOT_ONLY" },
  { id: "RANDOM_WEAPON", label: "Random Weapon", description: "Random weapon modifier.", weaponModifier: "RANDOM_WEAPON" },
  { id: "FIRST_TO_10", label: "First to 10", description: "First player to 10 rounds.", weaponModifier: null },
  { id: "HIGH_STAKES", label: "High Stakes", description: "High-stakes 1v1.", weaponModifier: null },
] as const;

export type DuelModeId = (typeof DUEL_MODES)[number]["id"];
export const DUEL_MODE_IDS = DUEL_MODES.map((mode) => mode.id) as DuelModeId[];
export const DUEL_FORMATS = ["1v1"] as const;

export function isDuelMode(value: unknown): value is DuelModeId {
  return typeof value === "string" && DUEL_MODE_IDS.includes(value as DuelModeId);
}

export function normalizeModeWeaponModifier(mode: DuelModeId, modifier: unknown) {
  const requested = typeof modifier === "string" && modifier.trim() ? modifier.trim() : null;
  const config = DUEL_MODES.find((item) => item.id === mode);
  if (!config) return { ok: false as const, error: "INVALID_MODE" };
  if (config.weaponModifier) {
    if (requested && requested !== config.weaponModifier) return { ok: false as const, error: "MODE_MODIFIER_CONFLICT" };
    return { ok: true as const, weaponModifier: config.weaponModifier };
  }
  if (requested && requested !== "STANDARD") return { ok: false as const, error: "MODE_MODIFIER_CONFLICT" };
  return { ok: true as const, weaponModifier: null };
}
