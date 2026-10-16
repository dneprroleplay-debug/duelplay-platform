// One-off reconciliation for historical achievements.
//
// DEFAULT MODE IS READ-ONLY: it prints, per user, which achievements are complete
// but have no UserAchievement record. It never writes unless `--apply` is passed.
//
// Usage (NOT to be run automatically):
//   node scripts/backfill-achievements.mjs            # preview only, no writes
//   node scripts/backfill-achievements.mjs --apply    # apply idempotently
//
// Applying is safe and idempotent: it reuses the same atomic insert
// (createMany + skipDuplicates on @@unique([userId, achievementId])) and grants
// each reward exactly once. DEMO economy is untouched.
import { PrismaClient } from '@prisma/client';
import { evaluateAndUnlockAchievements } from '../lib/achievements.ts';
import { resolveAchievement } from '../lib/achievement-conditions.ts';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

async function pendingFor(userId) {
  const [stats, kills, user, achievements, unlocked, knife] = await Promise.all([
    prisma.playerStats.findUnique({ where: { userId }, select: { wins: true, totalDuels: true, winStreak: true } }),
    prisma.matchPlayerStat.aggregate({ where: { userId }, _sum: { kills: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { level: true } }),
    prisma.achievement.findMany(),
    prisma.userAchievement.findMany({ where: { userId }, select: { achievementId: true } }),
    prisma.match.findFirst({ where: { winnerId: userId, economyMode: 'REAL', status: 'FINISHED', weaponModifier: 'KNIFE_ONLY' }, select: { id: true } }),
  ]);
  const unlockedIds = new Set(unlocked.map(x => x.achievementId));
  const persisted = {
    wins: Number(stats?.wins ?? 0),
    totalDuels: Number(stats?.totalDuels ?? 0),
    winStreak: Number(stats?.winStreak ?? 0),
    kills: Number(kills._sum.kills ?? 0),
    level: Number(user?.level ?? 0),
    hasKnifeWin: Boolean(knife),
  };
  return achievements
    .filter(a => !unlockedIds.has(a.id))
    .map(a => ({ name: a.name, resolved: resolveAchievement(a, persisted) }))
    .filter(x => x.resolved.complete)
    .map(x => x.name);
}

async function main() {
  const users = await prisma.user.findMany({ select: { id: true, nickname: true } });
  let usersWithPending = 0;
  let totalPending = 0;
  let totalApplied = 0;

  for (const user of users) {
    const pending = await pendingFor(user.id);
    if (pending.length === 0) continue;
    usersWithPending += 1;
    totalPending += pending.length;
    console.log(`${user.nickname ?? user.id}: ${apply ? 'applying' : 'would unlock'} -> ${pending.join(', ')}`);
    if (apply) {
      const unlocked = await prisma.$transaction(tx => evaluateAndUnlockAchievements(tx, user.id), { timeout: 20000 });
      totalApplied += unlocked.length;
    }
  }

  console.log(`\n${apply ? 'Backfill applied' : 'Preview only (no writes)'}.`);
  console.log(`Users with pending achievements: ${usersWithPending}`);
  console.log(`Achievements ${apply ? 'newly unlocked' : 'pending'}: ${apply ? totalApplied : totalPending}`);
  if (!apply) console.log('Re-run with --apply to grant them (idempotent).');
}

main().catch(error => { console.error(error); process.exit(1); }).finally(() => prisma.$disconnect());
