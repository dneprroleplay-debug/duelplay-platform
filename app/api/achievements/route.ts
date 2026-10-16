import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/current-user';
import { reconcileUserAchievements } from '@/lib/achievements-reconcile';
import { resolveAchievement, type PersistedAchievementStats } from '@/lib/achievement-conditions';

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Reconcile before reading so the displayed progress and the persisted unlock
  // records share one condition source. Idempotent and safe under concurrency.
  await reconcileUserAchievements(me.id);

  const [achievements, unlocked, stats, kills, user, knifeWin] = await Promise.all([
    prisma.achievement.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.userAchievement.findMany({ where: { userId: me.id }, select: { achievementId: true, unlockedAt: true } }),
    prisma.playerStats.findUnique({ where: { userId: me.id }, select: { wins: true, totalDuels: true, winStreak: true } }),
    prisma.matchPlayerStat.aggregate({ where: { userId: me.id }, _sum: { kills: true } }),
    prisma.user.findUnique({ where: { id: me.id }, select: { level: true } }),
    prisma.match.findFirst({ where: { winnerId: me.id, economyMode: 'REAL', status: 'FINISHED', weaponModifier: 'KNIFE_ONLY' }, select: { id: true } }),
  ]);
  const unlockedMap = new Map(unlocked.map(x => [x.achievementId, x.unlockedAt]));
  const persisted: PersistedAchievementStats = {
    wins: Number(stats?.wins ?? 0),
    totalDuels: Number(stats?.totalDuels ?? 0),
    winStreak: Number(stats?.winStreak ?? 0),
    kills: Number(kills._sum.kills ?? 0),
    level: Number(user?.level ?? 0),
    hasKnifeWin: Boolean(knifeWin),
  };
  return NextResponse.json({ achievements: achievements.map(a => {
    const resolved = resolveAchievement(a, persisted);
    return {
      ...a,
      unlocked: unlockedMap.has(a.id),
      unlockedAt: unlockedMap.get(a.id) ?? null,
      progress: { value: resolved.value, target: resolved.target, percent: Math.min(100, Math.round(resolved.value / resolved.target * 100)) },
    };
  }) });
}
