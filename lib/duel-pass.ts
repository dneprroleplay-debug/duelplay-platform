import { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export function duelPassLevelForXp(xp: number, maxLevel: number) {
  const safeXp = Math.max(0, Math.floor(xp));
  const max = Math.max(1, Math.floor(maxLevel));
  return Math.min(max, Math.floor(safeXp / 100) + 1);
}

export function duelPassLevelProgress(xp: number, maxLevel: number) {
  const safeXp = Math.max(0, Math.floor(xp));
  const max = Math.max(1, Math.floor(maxLevel));
  const level = duelPassLevelForXp(safeXp, max);
  if (level >= max) return { level, currentXp: safeXp, nextLevelXp: safeXp, percent: 100 };
  const levelStart = (level - 1) * 100;
  const nextLevelXp = level * 100;
  return { level, currentXp: safeXp - levelStart, nextLevelXp: nextLevelXp - levelStart, percent: Math.min(100, Math.floor(((safeXp - levelStart) / 100) * 100)) };
}

export async function awardDuelPassXp(tx: Tx, userId: string, amount: number) {
  const gain = Math.max(0, Math.floor(Number(amount) || 0));
  if (!gain) return null;
  const now = new Date();
  const pass = await tx.duelPass.findFirst({
    where: { active: true, startsAt: { lte: now }, endsAt: { gte: now } },
    orderBy: { createdAt: "desc" },
  });
  if (!pass) return null;

  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('duelplay:duelpass-xp'))`;
  const progress = await tx.duelPassProgress.upsert({
    where: { passId_userId: { passId: pass.id, userId } },
    update: { xp: { increment: gain } },
    create: { passId: pass.id, userId, xp: gain, level: duelPassLevelForXp(gain, pass.maxLevel) },
  });
  const nextLevel = duelPassLevelForXp(progress.xp, pass.maxLevel);
  if (progress.level !== nextLevel) {
    return tx.duelPassProgress.update({ where: { id: progress.id }, data: { level: nextLevel } });
  }
  return progress;
}
