export type League = "BRONZE" | "SILVER" | "GOLD" | "DIAMOND" | "ELITE";

export const LEAGUE_THRESHOLDS: Readonly<Record<League, number>> = {
  BRONZE: 0,
  SILVER: 1200,
  GOLD: 1400,
  DIAMOND: 1600,
  ELITE: 1800,
};

export function leagueFromRating(rating: number): League {
  const value = Number.isFinite(rating) ? rating : 1000;
  if (value >= LEAGUE_THRESHOLDS.ELITE) return "ELITE";
  if (value >= LEAGUE_THRESHOLDS.DIAMOND) return "DIAMOND";
  if (value >= LEAGUE_THRESHOLDS.GOLD) return "GOLD";
  if (value >= LEAGUE_THRESHOLDS.SILVER) return "SILVER";
  return "BRONZE";
}

export function nextLeagueThreshold(rating: number) {
  const value = Number.isFinite(rating) ? rating : 1000;
  return Object.values(LEAGUE_THRESHOLDS).find((threshold) => threshold > value) ?? null;
}

export function pointsToNextLeague(rating: number) {
  const next = nextLeagueThreshold(rating);
  return next === null ? 0 : Math.max(0, next - (Number.isFinite(rating) ? rating : 1000));
}

export function leagueProgress(rating: number) {
  const value = Number.isFinite(rating) ? rating : 1000;
  const league = leagueFromRating(value);
  const current = LEAGUE_THRESHOLDS[league];
  const next = nextLeagueThreshold(value);
  if (next === null) return 100;
  return Math.min(100, Math.max(0, ((value - current) / (next - current)) * 100));
}

export function leagueLabel(league: League) {
  return { BRONZE: "🥉 Bronze", SILVER: "🥈 Silver", GOLD: "🥇 Gold", DIAMOND: "💎 Diamond", ELITE: "👑 Elite" }[league];
}
