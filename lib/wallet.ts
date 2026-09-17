import { Prisma } from "@prisma/client";

export async function debitWallet(tx: Prisma.TransactionClient, userId: string, amount: number, idempotencyKey: string, type: "MATCH_BET"|"TOURNAMENT_ENTRY"|"CASE_OPEN"|"BONUS"|"WITHDRAW"|"COMMISSION"|"COSMETIC_PURCHASE"|"PRIME_PURCHASE"|"DUELPASS_PURCHASE"|"EVENTPASS_PURCHASE"|"XP_BOOSTER_PURCHASE"|"TOURNAMENT_PRIZE"|"REFERRAL_RACE_PRIZE"|"INVENTORY_SALE" = "BONUS", description?: string, referenceId?: string) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) throw new Error("INVALID_AMOUNT");
  const existing = await tx.transaction.findUnique({ where: { idempotencyKey } });
  if (existing) return { idempotent: true, transaction: existing };
  const rows = await tx.$queryRaw<Array<{ id: string; balance: Prisma.Decimal }>>`SELECT id, balance FROM "Wallet" WHERE "userId" = ${userId}::uuid FOR UPDATE`;
  const wallet = rows[0];
  if (!wallet) throw new Error("WALLET");
  const before = Number(wallet.balance);
  if (before < value) throw new Error("INSUFFICIENT_BALANCE");
  const after = Number((before - value).toFixed(4));
  await tx.wallet.update({ where: { id: wallet.id }, data: { balance: after } });
  const transaction = await tx.transaction.create({ data: { walletId: wallet.id, type, status: "COMPLETED", amount: -value, balanceBefore: before, balanceAfter: after, idempotencyKey, referenceId, description } });
  return { idempotent: false, transaction };
}

export async function creditWallet(tx: Prisma.TransactionClient, userId: string, amount: number, idempotencyKey: string, type: "MATCH_WIN"|"REFUND"|"BONUS"|"REFERRAL"|"DEPOSIT"|"TOURNAMENT_PRIZE"|"REFERRAL_RACE_PRIZE"|"INVENTORY_SALE" = "BONUS", description?: string, referenceId?: string) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) throw new Error("INVALID_AMOUNT");
  const existing = await tx.transaction.findUnique({ where: { idempotencyKey } });
  if (existing) return { idempotent: true, transaction: existing };
  const rows = await tx.$queryRaw<Array<{ id: string; balance: Prisma.Decimal }>>`SELECT id, balance FROM "Wallet" WHERE "userId" = ${userId}::uuid FOR UPDATE`;
  const wallet = rows[0];
  if (!wallet) throw new Error("WALLET");
  const before = Number(wallet.balance);
  const after = Number((before + value).toFixed(4));
  await tx.wallet.update({ where: { id: wallet.id }, data: { balance: after } });
  const transaction = await tx.transaction.create({ data: { walletId: wallet.id, type, status: "COMPLETED", amount: value, balanceBefore: before, balanceAfter: after, idempotencyKey, referenceId, description } });
  return { idempotent: false, transaction };
}
