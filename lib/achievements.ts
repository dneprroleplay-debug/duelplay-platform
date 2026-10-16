import { Prisma } from '@prisma/client';
import { levelFromXp } from './level.ts';
import { achievementKind, resolveAchievement, type PersistedAchievementStats } from './achievement-conditions.ts';

export type AchievementContext = {
  matchId?: string;
  won?: boolean;
  weapon?: string | null;
};

// Reads persisted achievement progress for a user. Kept in sync with the
// read-only display path (app/api/achievements/route.ts) via resolveAchievement.
async function loadPersistedStats(tx: Prisma.TransactionClient, userId: string) {
  const [stats, kills, user] = await Promise.all([
    tx.playerStats.findUnique({ where: { userId }, select: { wins: true, totalDuels: true, winStreak: true } }),
    tx.matchPlayerStat.aggregate({ where: { userId }, _sum: { kills: true } }),
    tx.user.findUnique({ where: { id: userId }, select: { id: true, xp: true, level: true } }),
  ]);
  return { stats, kills, user };
}

export async function hasKnifeWin(tx: Prisma.TransactionClient, userId: string): Promise<boolean> {
  const row = await tx.match.findFirst({
    where: { winnerId: userId, economyMode: 'REAL', status: 'FINISHED', weaponModifier: 'KNIFE_ONLY' },
    select: { id: true },
  });
  return Boolean(row);
}

/**
 * Idempotent achievement evaluation. The unlock condition is derived from the
 * same persisted data the UI displays, so historical progress is reconciled and
 * the progress bar can never show a completed goal that stays locked.
 *
 * The `context` argument is accepted for backward compatibility with the real
 * match settlement paths, but unlocking no longer depends on transient event
 * context (a knife win is detected from the persisted Match row).
 *
 * Rewards (XP + notification) are granted only when the `UserAchievement` row is
 * actually inserted. The atomic `createMany({ skipDuplicates: true })` insert
 * relies on `@@unique([userId, achievementId])`, which makes concurrent
 * evaluations safe: the loser of the race inserts 0 rows and awards nothing.
 */
export async function evaluateAndUnlockAchievements(
  tx: Prisma.TransactionClient,
  userId: string,
  _context: AchievementContext = {},
) {
  const { stats, kills, user } = await loadPersistedStats(tx, userId);
  if (!user) return [];

  const achievements = await tx.achievement.findMany({ orderBy: { createdAt: 'asc' } });
  const unlocked = await tx.userAchievement.findMany({ where: { userId }, select: { achievementId: true } });
  const unlockedIds = new Set(unlocked.map(x => x.achievementId));

  const pending = achievements.filter(a => !unlockedIds.has(a.id));
  const needsKnife = pending.some(a => achievementKind(a) === 'KNIFE_WIN');
  const knifeWin = needsKnife ? await hasKnifeWin(tx, userId) : false;

  const persisted: PersistedAchievementStats = {
    wins: Number(stats?.wins ?? 0),
    totalDuels: Number(stats?.totalDuels ?? 0),
    winStreak: Number(stats?.winStreak ?? 0),
    kills: Number(kills._sum.kills ?? 0),
    level: Number(user.level),
    hasKnifeWin: knifeWin,
  };

  const results: Array<{ id: string; name: string; xpReward: number }> = [];
  let currentXp = user.xp;
  let currentLevel = user.level;

  for (const achievement of achievements) {
    if (unlockedIds.has(achievement.id)) continue;
    // LEVEL is re-evaluated against the in-pass level so a reward that raises the
    // level can unlock the level achievement in the same pass. This is a single
    // pass over the catalog, so dependent rewards can never recurse.
    const resolved = resolveAchievement(achievement, { ...persisted, level: currentLevel });
    if (!resolved.complete) continue;

    const inserted = await tx.userAchievement.createMany({
      data: [{ userId, achievementId: achievement.id }],
      skipDuplicates: true,
    });
    if (Number(inserted?.count ?? 0) !== 1) continue;

    const xpReward = Math.max(0, Number(achievement.xpReward) || 0);
    if (xpReward > 0) {
      const nextXp = Math.max(0, Math.floor(currentXp + xpReward));
      const nextLevel = levelFromXp(nextXp);
      currentXp = nextXp;
      currentLevel = nextLevel;
      await tx.user.update({ where: { id: userId }, data: { xp: nextXp, level: nextLevel } });
    }
    await tx.notification.create({
      data: {
        userId,
        type: 'ACHIEVEMENT_UNLOCKED',
        title: 'Achievement unlocked',
        body: `${achievement.name}${xpReward ? ` · +${xpReward} XP` : ''}`,
        payload: { kind: 'ACHIEVEMENT_UNLOCKED', achievementId: achievement.id, name: achievement.name, xpReward },
      },
    });
    results.push({ id: achievement.id, name: achievement.name, xpReward });
  }

  return results;
}
