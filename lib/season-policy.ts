export const SEASON_MODES = ["OFF", "AUTO", "MANUAL"] as const;
export type SeasonMode = (typeof SEASON_MODES)[number];

export type SeasonCandidate = {
  id: string;
  name: string;
  theme: string;
  startsAt: Date;
  endsAt: Date;
  mode: SeasonMode;
  effects: unknown;
  active: boolean;
  createdAt?: Date;
};

const MAX_EFFECTS_BYTES = 20_000;
const MAX_INTENSITY = 200;
const MAX_PARTICLE = 40;

export function isValidSeasonWindow(startsAt: Date, endsAt: Date) {
  return Number.isFinite(startsAt.getTime()) && Number.isFinite(endsAt.getTime()) && endsAt > startsAt;
}

export function isSeasonEffective(season: SeasonCandidate, now = new Date()) {
  if (season.mode === "OFF") return false;
  if (!isValidSeasonWindow(season.startsAt, season.endsAt)) return false;
  if (season.startsAt > now || season.endsAt < now) return false;
  // AUTO seasons are activated by their time window; MANUAL seasons require the explicit active flag.
  if (season.mode === "MANUAL" && !season.active) return false;
  return true;
}

export function chooseEffectiveSeason(seasons: SeasonCandidate[], now = new Date()) {
  return seasons
    .filter((season) => isSeasonEffective(season, now))
    .sort((a, b) => {
      const modeRank = (mode: SeasonMode) => mode === "MANUAL" ? 2 : mode === "AUTO" ? 1 : 0;
      return modeRank(b.mode) - modeRank(a.mode)
        || b.startsAt.getTime() - a.startsAt.getTime()
        || (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)
        || a.id.localeCompare(b.id);
    })[0] ?? null;
}

export function normalizeSeasonEffects(effects: unknown) {
  if (effects == null) return null;
  if (typeof effects !== "object" || Array.isArray(effects)) throw new Error("Invalid effects");

  const value = effects as Record<string, unknown>;
  const json = JSON.stringify(value);
  if (!json || json.length > MAX_EFFECTS_BYTES) throw new Error("Effects too large");

  if (value.seasonId !== undefined) {
    if (typeof value.seasonId !== "string" || value.seasonId.length > 40) throw new Error("Invalid seasonId");
  }
  if (value.preset !== undefined) {
    if (typeof value.preset !== "string" || value.preset.length > 40) throw new Error("Invalid preset");
  }
  if (value.particle !== undefined) {
    if (typeof value.particle !== "string" || value.particle.length > MAX_PARTICLE) throw new Error("Invalid particle");
  }
  if (value.intensity !== undefined) {
    const intensity = Number(value.intensity);
    if (!Number.isFinite(intensity) || intensity < 0 || intensity > MAX_INTENSITY) throw new Error("Invalid intensity");
  }

  return value;
}
