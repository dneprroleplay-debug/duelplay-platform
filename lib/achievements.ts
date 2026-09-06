import { Prisma } from '@prisma/client';

export type AchievementContext = {
  matchId?: string;
  won?: boolean;
  weapon?: string | null;
};

function condition(achievement: { conditions: Prisma.JsonValue }, fallbackName: string) {
  const raw = achievement.conditions;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return { name: fallbackName };
}

export async function evaluateAndUnlockAchievements(
  tx: Prisma.TransactionClient,
  userId: string,
  context: AchievementContext = {},
) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, xp: true, level: true } });
  if (!user) return [];

  const stats = await tx.playerStats.findUnique({ where: { userId }, select: { wins: true, totalDuels: true, winStreak: true } });
  const kills = await tx.matchPlayerStat.aggregate({ where: { userId }, _sum: { kills: true } });
  const achievements = await tx.achievement.findMany({ orderBy: { createdAt: 'asc' } });
  const unlocked = await tx.userAchievement.findMany({ where: { userId }, select: { achievementId: true } });
  const unlockedIds = new Set(unlocked.map(x => x.achievementId));
  const results: Array<{ id: string; name: string; xpReward: number }> = [];

  for (const achievement of achievements) {
    if (unlockedIds.has(achievement.id)) continue;
    const c = condition(achievement, achievement.name);
    const kind = String(c.kind ?? c.name ?? achievement.name);
    const target = Number(c.target ?? 1);
    let complete = false;

    switch (kind) {
      case 'FIRST_WIN': complete = Boolean(context.won) && Number(stats?.wins ?? 0) >= 1; break;
      case 'WIN_STREAK': complete = Number(stats?.winStreak ?? 0) >= target; break;
      case 'TOTAL_DUELS': complete = Number(stats?.totalDuels ?? 0) >= target; break;
      case 'TOTAL_KILLS': complete = Number(kills._sum.kills ?? 0) >= target; break;
      case 'KNIFE_WIN': complete = Boolean(context.won) && String(context.weapon ?? '').toUpperCase().includes('KNIFE'); break;
      case 'LEVEL': complete = Number(user.level) >= target; break;
      default: break;
    }

    if (!complete) continue;
    await tx.userAchievement.create({ data: { userId, achievementId: achievement.id } });
    const xpReward = Math.max(0, Number(achievement.xpReward) || 0);
    if (xpReward > 0) {
      const nextXp = Math.max(0, Math.floor(user.xp + xpReward));
      const nextLevel = Math.max(1, Math.min(100, Math.floor(Math.sqrt(nextXp / 100)) + 1));
      user.xp = nextXp;
      user.level = nextLevel;
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
