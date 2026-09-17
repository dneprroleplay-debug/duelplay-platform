import type { Prisma } from "@prisma/client";

export type TrustLevel = "NEW" | "VERIFIED" | "TRUSTED" | "ELITE";

export function trustLevelFromScore(score: number): TrustLevel {
  if (score >= 90) return "ELITE";
  if (score >= 75) return "TRUSTED";
  if (score >= 50) return "VERIFIED";
  return "NEW";
}

export async function recalculateTrust(tx: Prisma.TransactionClient, userId: string) {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { createdAt: true, reputation: true, trustScore: true },
  });
  if (!user) return null;

  const [matches, transactions, violations, fraudCases] = await Promise.all([
    tx.match.count({ where: { OR: [{ playerOneId: userId }, { playerTwoId: userId }], status: "FINISHED" } }),
    tx.transaction.count({ where: { wallet: { userId }, status: "COMPLETED" } }),
    tx.report.count({ where: { targetId: userId, status: "RESOLVED" } }),
    tx.fraudCase.count({ where: { userId, status: { in: ["DETECTED", "UNDER_INVESTIGATION"] } } }),
  ]);

  const ageDays = Math.max(0, (Date.now() - user.createdAt.getTime()) / 86_400_000);
  const ageScore = Math.min(20, ageDays / 30);
  const matchScore = Math.min(25, matches * 0.5);
  const transactionScore = Math.min(20, transactions * 0.5);
  const reputationScore = Math.max(0, Math.min(25, Number(user.reputation) / 40));
  const penalty = Math.min(50, violations * 12 + fraudCases * 20);
  const score = Math.max(0, Math.min(100, ageScore + matchScore + transactionScore + reputationScore + 10 - penalty));

  await tx.user.update({ where: { id: userId }, data: { trustScore: Number(score.toFixed(2)) } });
  return { score, level: trustLevelFromScore(score) };
}
