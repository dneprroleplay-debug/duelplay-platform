import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/current-user';

function progressFor(name: string, conditions: unknown, stats: any, kills: number, level: number, won: boolean, weapon: string | null) {
  const c = conditions && typeof conditions === 'object' && !Array.isArray(conditions) ? conditions as Record<string, unknown> : { name };
  const kind = String(c.kind ?? c.name ?? name);
  const target = Math.max(1, Number(c.target ?? 1));
  let value = 0;
  if (kind === 'FIRST_WIN') value = Math.min(stats.wins, 1);
  if (kind === 'WIN_STREAK') value = stats.winStreak;
  if (kind === 'TOTAL_DUELS') value = stats.totalDuels;
  if (kind === 'TOTAL_KILLS') value = kills;
  if (kind === 'KNIFE_WIN') value = weapon?.toUpperCase().includes('KNIFE') && won ? 1 : 0;
  if (kind === 'LEVEL') value = level;
  return { value: Math.max(0, value), target, percent: Math.min(100, Math.round(Math.max(0, value) / target * 100)) };
}

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const [achievements, unlocked, stats, kills, user] = await Promise.all([
    prisma.achievement.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.userAchievement.findMany({ where: { userId: me.id }, select: { achievementId: true, unlockedAt: true } }),
    prisma.playerStats.findUnique({ where: { userId: me.id }, select: { wins: true, totalDuels: true, winStreak: true } }),
    prisma.matchPlayerStat.aggregate({ where: { userId: me.id }, _sum: { kills: true } }),
    prisma.user.findUnique({ where: { id: me.id }, select: { level: true } }),
  ]);
  const unlockedMap = new Map(unlocked.map(x => [x.achievementId, x.unlockedAt]));
  return NextResponse.json({ achievements: achievements.map(a => ({
    ...a,
    unlocked: unlockedMap.has(a.id),
    unlockedAt: unlockedMap.get(a.id) ?? null,
    progress: progressFor(a.name, a.conditions, { wins: stats?.wins ?? 0, totalDuels: stats?.totalDuels ?? 0, winStreak: stats?.winStreak ?? 0 }, kills._sum.kills ?? 0, user?.level ?? 1, false, null),
  })) });
}
