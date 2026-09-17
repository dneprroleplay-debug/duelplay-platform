export type PlatformSettingKey =
  | "COMMISSION_RATE"
  | "REFERRAL_COMMISSION"
  | "MIN_STAKE"
  | "MAX_STAKE"
  | "MIN_DEPOSIT"
  | "MIN_WITHDRAWAL"
  | "XP_MULTIPLIER"
  | "REPUTATION_MULTIPLIER";

type Rule = { min: number; max: number; step: number };

export const PLATFORM_SETTING_RULES: Record<PlatformSettingKey, Rule> = {
  COMMISSION_RATE: { min: 0, max: 50, step: 0.5 },
  REFERRAL_COMMISSION: { min: 0, max: 50, step: 0.5 },
  MIN_STAKE: { min: 0.01, max: 100000, step: 0.01 },
  MAX_STAKE: { min: 0.01, max: 100000, step: 0.01 },
  MIN_DEPOSIT: { min: 0.01, max: 100000, step: 0.01 },
  MIN_WITHDRAWAL: { min: 0.01, max: 100000, step: 0.01 },
  XP_MULTIPLIER: { min: 0, max: 100, step: 0.1 },
  REPUTATION_MULTIPLIER: { min: 0, max: 100, step: 0.1 },
};

export function isPlatformSettingKey(key: string): key is PlatformSettingKey {
  return key in PLATFORM_SETTING_RULES;
}

export function validatePlatformSettingValue(key: string, raw: unknown) {
  if (!isPlatformSettingKey(key)) return { ok: false as const, error: "UNKNOWN_SETTING" };
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value)) return { ok: false as const, error: "INVALID_VALUE" };
  const rule = PLATFORM_SETTING_RULES[key];
  const units = value / rule.step;
  if (value < rule.min || value > rule.max || Math.abs(units - Math.round(units)) > 1e-8) {
    return { ok: false as const, error: "VALUE_OUT_OF_RANGE" };
  }
  return { ok: true as const, value: Number(value.toFixed(4)), rule };
}

export function validatePlatformSettingRelationships(values: Record<string, number>) {
  if (values.MIN_STAKE !== undefined && values.MAX_STAKE !== undefined && values.MIN_STAKE > values.MAX_STAKE) {
    return { ok: false as const, error: "MIN_STAKE_GT_MAX_STAKE" };
  }
  return { ok: true as const };
}
