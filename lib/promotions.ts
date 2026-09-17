import { Prisma } from "@prisma/client";

export async function referralMultiplier(tx: Prisma.TransactionClient) {
  const now = new Date();
  const p = await tx.promoCampaign.findFirst({
    where: { status: { in: ["SCHEDULED", "ACTIVE"] }, startsAt: { lte: now }, endsAt: { gte: now } },
    orderBy: { multiplier: "desc" },
  });
  return p ? Math.max(0, Number(p.multiplier)) : 1;
}

type PromotionRestrictions = {
  minDeposit?: number;
  maxDeposit?: number;
  providers?: string[];
  firstDepositOnly?: boolean;
};

function restrictionsOf(value: unknown): PromotionRestrictions {
  if (!value || typeof value !== "object") return {};
  const r = value as Record<string, unknown>;
  return {
    minDeposit: Number.isFinite(Number(r.minDeposit)) ? Number(r.minDeposit) : undefined,
    maxDeposit: Number.isFinite(Number(r.maxDeposit)) ? Number(r.maxDeposit) : undefined,
    providers: Array.isArray(r.providers) ? r.providers.map(String) : undefined,
    firstDepositOnly: r.firstDepositOnly === true,
  };
}

export async function depositBonus(tx: Prisma.TransactionClient, amount: number, provider?: string, userId?: string, depositId?: string) {
  const now = new Date();
  const promotions = await tx.depositPromotion.findMany({
    where: { active: true },
    orderBy: { multiplier: "desc" },
  });
  for (const p of promotions) {
    const r = restrictionsOf(p.restrictions);
    if (r.minDeposit !== undefined && amount < r.minDeposit) continue;
    if (r.maxDeposit !== undefined && amount > r.maxDeposit) continue;
    if (provider && r.providers?.length && !r.providers.includes(provider)) continue;
    if (r.firstDepositOnly && userId) {
      const previous = await tx.deposit.count({ where: { wallet: { userId }, status: "COMPLETED", ...(depositId ? { id: { not: depositId } } : {}) } });
      if (previous > 0) continue;
    }
    const multiplier = Math.max(1, Number(p.multiplier));
    const rawBonus = p.type.toUpperCase() === "FIXED" ? multiplier : amount * (multiplier - 1);
    const bonus = Math.min(Number(p.maxBonus), rawBonus);
    if (bonus > 0) return { promotion: p, bonus: Number(bonus.toFixed(4)) };
  }
  return null;
}

export async function grantDepositBonus(
  tx: Prisma.TransactionClient,
  userId: string,
  depositId: string,
  amount: number,
  provider: string,
) {
  const existing = await tx.depositBonusGrant.findUnique({ where: { depositId } });
  if (existing) return existing;
  const selected = await depositBonus(tx, amount, provider, userId, depositId);
  if (!selected) return null;
  const expiresAt = selected.promotion.expiresHours > 0
    ? new Date(Date.now() + selected.promotion.expiresHours * 60 * 60 * 1000)
    : null;
  const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId } });
  const grant = await tx.depositBonusGrant.create({
    data: {
      userId,
      depositId,
      promotionId: selected.promotion.id,
      amount: selected.bonus,
      wagering: Number(selected.promotion.wagering),
      withdrawable: selected.promotion.withdrawable,
      expiresAt,
    },
  });
  await tx.wallet.update({ where: { id: wallet.id }, data: { bonusBalance: { increment: selected.bonus } } });
  await tx.transaction.create({
    data: {
      walletId: wallet.id,
      type: "BONUS",
      status: "COMPLETED",
      amount: selected.bonus,
      balanceBefore: Number(wallet.balance),
      balanceAfter: Number(wallet.balance),
      referenceId: depositId,
      idempotencyKey: `deposit-bonus:${depositId}`,
      description: `Deposit promotion bonus · $${selected.bonus.toFixed(2)}`,
    },
  });
  await tx.notification.create({
    data: {
      userId,
      type: "PROMOTION",
      title: "Deposit bonus credited",
      body: `$${selected.bonus.toFixed(2)} deposit bonus added to your bonus balance.`,
      payload: { depositId, promotionId: selected.promotion.id, expiresAt },
    },
  });
  return grant;
}
