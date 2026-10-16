import { prisma } from '@/lib/prisma';
import { evaluateAndUnlockAchievements } from '@/lib/achievements';

/**
 * Idempotent reconciliation for a single user. Safe to call repeatedly and from
 * concurrent requests: it only inserts missing UserAchievement rows (atomic,
 * skipDuplicates) and grants each reward exactly once.
 */
export async function reconcileUserAchievements(userId: string) {
  return prisma.$transaction(tx => evaluateAndUnlockAchievements(tx, userId), { timeout: 15000 });
}
