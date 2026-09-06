import type { Prisma } from "@prisma/client";

export type RiskDecision = { score: number; flags: string[] };

export async function assessUserRisk(tx: Prisma.TransactionClient, userId: string): Promise<RiskDecision> {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true, trustScore: true } });
  if (!user) throw new Error("USER_NOT_FOUND");

  const [fraud, reports, rapidEvents] = await Promise.all([
    tx.fraudCase.count({ where: { userId, status: { in: ["DETECTED", "UNDER_INVESTIGATION"] } } }),
    tx.report.count({ where: { targetId: userId, status: "OPEN" } }),
    tx.securityEvent.count({ where: { userId, eventType: { in: ["CASE_OPEN", "REPORT_CREATE", "MESSAGE_SEND"] }, createdAt: { gte: new Date(Date.now() - 60_000) } } }),
  ]);

  const flags: string[] = [];
  let score = Math.max(0, 50 - Number(user.trustScore) * 0.35);
  if (fraud) { score += Math.min(40, fraud * 20); flags.push("ACTIVE_FRAUD_CASE"); }
  if (reports) { score += Math.min(20, reports * 10); flags.push("OPEN_REPORTS"); }
  if (rapidEvents >= 20) { score += 10; flags.push("HIGH_ACTIVITY"); }
  score = Math.min(100, Math.round(score));
  return { score, flags };
}

export async function assertAccountCanPlay(tx: Prisma.TransactionClient, userId: string) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (!user) throw new Error("USER_NOT_FOUND");
  if (user.status === "SUSPENDED") throw new Error("ACCOUNT_SUSPENDED");
  if (user.status === "BANNED") throw new Error("ACCOUNT_BANNED");
  if (user.status === "DEACTIVATED") throw new Error("ACCOUNT_DEACTIVATED");
  return user;
}

export async function recordFraudSignal(tx: Prisma.TransactionClient, userId: string, score: number, reason: string, metadata?: Prisma.InputJsonValue) {
  if (score < 50) return null;
  const recent = await tx.fraudCase.findFirst({ where: { userId, status: { in: ["DETECTED", "UNDER_INVESTIGATION"] }, reason, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }, orderBy: { createdAt: "desc" } });
  if (recent) return recent;
  return tx.fraudCase.create({ data: { userId, status: "DETECTED", riskScore: score, reason, aiResult: metadata ? { source: "rule-engine", metadata } : { source: "rule-engine" } } });
}

export async function assertAbuseGuard(tx: Prisma.TransactionClient, userId: string, eventType: string) {
  const risk = await assessUserRisk(tx, userId);

  // Risk is a signal, not an automatic punishment. Only a severe, corroborated
  // state blocks sensitive automation; ordinary reports/high activity stay soft flags.
  if (risk.score >= 90 && risk.flags.includes("ACTIVE_FRAUD_CASE")) {
    await tx.securityEvent.create({
      data: {
        userId,
        eventType: "ABUSE_GUARD_BLOCK",
        severity: "WARN",
        ipAddress: "application",
        metadata: { attemptedEvent: eventType, score: risk.score, flags: risk.flags },
      },
    });
    throw new Error("ABUSE_GUARD_BLOCKED");
  }

  return risk;
}

export async function assertAccountCanWithdraw(tx: Prisma.TransactionClient, userId: string) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (!user) throw new Error("USER_NOT_FOUND");
  if (user.status === "SUSPENDED" || user.status === "BANNED") throw new Error("WITHDRAWALS_FROZEN");
  if (user.status === "DEACTIVATED") throw new Error("ACCOUNT_DEACTIVATED");
  return user;
}
