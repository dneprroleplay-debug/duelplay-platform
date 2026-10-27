import { createHmac } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { creditWallet } from "@/lib/wallet";
import { isRecoveryNoticeEligible, isRecoveryRestoreEligible } from "@/lib/account-recovery-policy";

export const ACCOUNT_RECOVERY_AVAILABLE = "AVAILABLE";
export const ACCOUNT_RECOVERY_RESTORED = "RESTORED";

export function recoveryHmac(value: string, kind: "email" | "steam") {
  const secret = process.env.DUELPLAY_ACCOUNT_RECOVERY_HMAC_SECRET?.trim();
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) throw new Error("ACCOUNT_RECOVERY_SECRET_REQUIRED");
  const normalized = kind === "email" ? value.trim().toLowerCase() : value.trim();
  if (!normalized || (kind === "steam" && !/^\d{17}$/.test(normalized))) throw new Error("ACCOUNT_RECOVERY_IDENTITY_INVALID");
  return createHmac("sha256", secret).update(`duelplay-account-recovery:v1:${kind}:${normalized}`).digest("hex");
}

export async function findAvailableRecoveryForEmail(db: Prisma.TransactionClient | typeof prisma, email: string) {
  const emailHmac = recoveryHmac(email, "email");
  const rows = await db.accountRecovery.findMany({
    where: { emailHmac, status: ACCOUNT_RECOVERY_AVAILABLE, realBalance: { gt: new Prisma.Decimal(0) } },
    orderBy: { createdAt: "desc" },
  });
  const valid = [];
  for (const row of rows) {
    const [hold, source, oldUser, oldWallet] = await Promise.all([
      db.transaction.findUnique({ where: { id: row.recoveryHoldTransactionId }, select: { id: true, status: true, type: true, amount: true, balanceBefore: true, balanceAfter: true, walletId: true, createdAt: true, wallet: { select: { userId: true } } } }),
      row.sourceLastTransactionId ? db.transaction.findUnique({ where: { id: row.sourceLastTransactionId }, select: { id: true, status: true, balanceAfter: true, wallet: { select: { userId: true } } } }) : Promise.resolve(null),
      db.user.findUnique({ where: { id: row.oldUserId }, select: { status: true, deletedAt: true, email: true, steamId: true } }),
      db.wallet.findUnique({ where: { userId: row.oldUserId }, select: { balance: true } }),
    ]);
    const laterLedgerCount = hold ? await db.transaction.count({ where: { walletId: hold.walletId, createdAt: { gt: hold.createdAt } } }) : 1;
    const oldAccountAnonymized = Boolean(oldUser?.status === "DEACTIVATED" && oldUser.deletedAt && !oldUser.email && !oldUser.steamId);
    const sourceLedgerMatches = Boolean(source && source.wallet.userId === row.oldUserId && source.status === "COMPLETED" && source.balanceAfter.eq(row.realBalance));
    const holdLedgerMatches = Boolean(hold && hold.wallet.userId === row.oldUserId && hold.status === "COMPLETED" && hold.type === "ACCOUNT_DELETION_RECOVERY_HOLD" && hold.amount.eq(row.realBalance.negated()) && hold.balanceBefore.eq(row.realBalance) && hold.balanceAfter.eq(0));
    if (isRecoveryNoticeEligible({ emailConfirmed: true, status: row.status, realBalance: row.realBalance.toFixed(4), sourceLedgerMatches, holdLedgerMatches, oldAccountAnonymized, oldWalletZero: Boolean(oldWallet?.balance.eq(0)), laterLedgerCount })) valid.push(row);
  }
  // Ambiguous historical identities fail closed instead of exposing or combining balances.
  return valid.length === 1 ? valid[0] : null;
}

export async function restoreAvailableRecovery(tx: Prisma.TransactionClient, input: { userId: string; email: string; steamId: string; actorIp: string; actorUserAgent: string }) {
  const secret = process.env.DUELPLAY_ACCOUNT_RECOVERY_HMAC_SECRET?.trim();
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) return { restored: false as const, reason: "SECRET_UNAVAILABLE" as const };
  const emailHmac = recoveryHmac(input.email, "email");
  const steamHmac = recoveryHmac(input.steamId, "steam");
  const candidates = await tx.accountRecovery.findMany({
    where: { emailHmac, steamHmac, status: ACCOUNT_RECOVERY_AVAILABLE, realBalance: { gt: new Prisma.Decimal(0) } },
    take: 2,
    orderBy: { createdAt: "desc" },
  });
  if (candidates.length === 0) return { restored: false as const, reason: "NO_MATCH" as const };
  if (candidates.length !== 1) {
    await tx.auditLog.create({ data: { userId: input.userId, action: "ACCOUNT_BALANCE_RECOVERY_CONFLICT", targetType: "ACCOUNT_RECOVERY", targetId: null, ipAddress: input.actorIp, userAgent: input.actorUserAgent, result: "FAILURE", reason: "Ambiguous recovery identity; no funds moved", payload: { result: "CONFLICT", newUserId: input.userId } } });
    return { restored: false as const, reason: "CONFLICT" as const };
  }
  const candidate = candidates[0];
  if (input.userId === candidate.oldUserId) return { restored: false as const, reason: "IDENTITY_CONFLICT" as const };
  const currentUser = await tx.user.findUnique({ where: { id: input.userId }, select: { email: true, emailVerifiedAt: true, steamId: true, status: true, deletedAt: true } });
  const identityConfirmed = Boolean(currentUser && currentUser.status === "ACTIVE" && !currentUser.deletedAt && currentUser.emailVerifiedAt && currentUser.email?.trim().toLowerCase() === input.email.trim().toLowerCase() && currentUser.steamId === input.steamId);
  if (!identityConfirmed || input.userId === candidate.oldUserId || candidate.emailHmac !== emailHmac || candidate.steamHmac !== steamHmac) return { restored: false as const, reason: "IDENTITY_NOT_CONFIRMED" as const };
  await tx.$queryRaw`SELECT "id" FROM "AccountRecovery" WHERE "id" = ${candidate.id}::uuid FOR UPDATE`;
  const recovery = await tx.accountRecovery.findUnique({ where: { id: candidate.id } });
  if (!recovery || recovery.status !== ACCOUNT_RECOVERY_AVAILABLE || !recovery.realBalance.gt(0) || recovery.emailHmac !== emailHmac || recovery.steamHmac !== steamHmac) return { restored: false as const, reason: "ALREADY_USED" as const };
  const [hold, source, oldUser, oldWallet] = await Promise.all([
    tx.transaction.findUnique({ where: { id: recovery.recoveryHoldTransactionId }, select: { id: true, status: true, type: true, amount: true, balanceBefore: true, balanceAfter: true, walletId: true, createdAt: true, wallet: { select: { userId: true } } } }),
    recovery.sourceLastTransactionId ? tx.transaction.findUnique({ where: { id: recovery.sourceLastTransactionId }, select: { id: true, status: true, balanceAfter: true, wallet: { select: { userId: true } } } }) : Promise.resolve(null),
    tx.user.findUnique({ where: { id: recovery.oldUserId }, select: { status: true, deletedAt: true, email: true, steamId: true } }),
    tx.wallet.findUnique({ where: { userId: recovery.oldUserId }, select: { balance: true } }),
  ]);
  const laterLedgerCount = hold ? await tx.transaction.count({ where: { walletId: hold.walletId, createdAt: { gt: hold.createdAt } } }) : 1;
  if (!oldUser || oldUser.status !== "DEACTIVATED" || !oldUser.deletedAt || oldUser.email || oldUser.steamId || !oldWallet?.balance.eq(0) || laterLedgerCount !== 0 || !hold || !source || source.wallet.userId !== recovery.oldUserId || hold.wallet.userId !== recovery.oldUserId || source.status !== "COMPLETED" || !source.balanceAfter.eq(recovery.realBalance) || hold.status !== "COMPLETED" || hold.type !== "ACCOUNT_DELETION_RECOVERY_HOLD" || !hold.amount.eq(recovery.realBalance.negated()) || !hold.balanceBefore.eq(recovery.realBalance) || !hold.balanceAfter.eq(0)) return { restored: false as const, reason: "LEDGER_INVALID" as const };
  if (!isRecoveryRestoreEligible({ emailHmacMatches: recovery.emailHmac === emailHmac, steamHmacMatches: recovery.steamHmac === steamHmac, emailConfirmed: Boolean(currentUser?.emailVerifiedAt), activeNewAccount: Boolean(currentUser?.status === "ACTIVE" && !currentUser.deletedAt), isDifferentInternalAccount: input.userId !== recovery.oldUserId, recoveryAvailable: recovery.status === ACCOUNT_RECOVERY_AVAILABLE, ledgerVerified: true })) return { restored: false as const, reason: "LEDGER_INVALID" as const };

  const credited = await creditWallet(tx, input.userId, recovery.realBalance, `account-recovery:${recovery.id}:credit`, "ACCOUNT_DELETION_RECOVERY_CREDIT", "REAL balance restored after verified account recovery", recovery.id);
  if (credited.idempotent) throw new Error("ACCOUNT_RECOVERY_CREDIT_ALREADY_EXISTS");
  const changed = await tx.accountRecovery.updateMany({ where: { id: recovery.id, status: ACCOUNT_RECOVERY_AVAILABLE }, data: { status: ACCOUNT_RECOVERY_RESTORED, restoredAt: new Date(), restoredUserId: input.userId, restoreTransactionId: credited.transaction.id } });
  if (changed.count !== 1) throw new Error("ACCOUNT_RECOVERY_ALREADY_USED");
  await tx.auditLog.create({ data: { userId: input.userId, action: "ACCOUNT_BALANCE_RECOVERED", targetType: "ACCOUNT_RECOVERY", targetId: recovery.id, ipAddress: input.actorIp, userAgent: input.actorUserAgent, result: "SUCCESS", reason: "Confirmed email HMAC and verified Steam ID matched; atomic ledger credit", payload: { recoveryId: recovery.id, oldUserId: recovery.oldUserId, newUserId: input.userId, realBalance: recovery.realBalance.toFixed(4), currency: "REAL", sourceLastTransactionId: recovery.sourceLastTransactionId, recoveryHoldTransactionId: recovery.recoveryHoldTransactionId, restoreTransactionId: credited.transaction.id, restoredAt: new Date().toISOString(), result: "SUCCESS" } } });
  return { restored: true as const, amount: recovery.realBalance.toFixed(4), transactionId: credited.transaction.id };
}
