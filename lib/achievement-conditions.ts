export type AchievementLike = { name: string; conditions: unknown };

export type PersistedAchievementStats = {
  wins: number;
  totalDuels: number;
  winStreak: number;
  kills: number;
  level: number;
  hasKnifeWin: boolean;
};

export type ResolvedAchievement = {
  kind: string;
  target: number;
  value: number;
  complete: boolean;
};

function conditionsOf(achievement: AchievementLike): Record<string, unknown> {
  const raw = achievement.conditions;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return {};
}

export function achievementKind(achievement: AchievementLike): string {
  const c = conditionsOf(achievement);
  return String(c.kind ?? c.name ?? achievement.name);
}

export function achievementTarget(achievement: AchievementLike): number {
  const c = conditionsOf(achievement);
  return Math.max(1, Number(c.target ?? 1));
}

// The single source of truth for achievement progress. Every value is derived
// from persisted data (PlayerStats / MatchPlayerStat / User.level / Match rows),
// so the displayed progress and the unlock decision can never disagree.
export function achievementValue(kind: string, stats: PersistedAchievementStats): number {
  switch (kind) {
    case 'FIRST_WIN': return Math.min(Math.max(0, Math.floor(stats.wins)), 1);
    case 'WIN_STREAK': return Math.max(0, Math.floor(stats.winStreak));
    case 'TOTAL_DUELS': return Math.max(0, Math.floor(stats.totalDuels));
    case 'TOTAL_KILLS': return Math.max(0, Math.floor(stats.kills));
    case 'KNIFE_WIN': return stats.hasKnifeWin ? 1 : 0;
    case 'LEVEL': return Math.max(0, Math.floor(stats.level));
    default: return 0;
  }
}

export function resolveAchievement(achievement: AchievementLike, stats: PersistedAchievementStats): ResolvedAchievement {
  const kind = achievementKind(achievement);
  const target = achievementTarget(achievement);
  const value = achievementValue(kind, stats);
  return { kind, target, value, complete: value >= target };
}
