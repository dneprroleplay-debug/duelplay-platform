import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { Prisma, PaymentProvider } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { grantDepositBonus } from "@/lib/promotions";
import { creditWallet, debitWallet, lockWallet } from "@/lib/wallet";
import { assertAccountCanWithdraw, assessUserRisk } from "@/lib/anti-fraud";
import { getPlatformNumber } from "@/lib/platform-settings";
import { isPaymentGatewayConfigured, getConfiguredPaymentProvider } from "@/lib/payment-gateway";
import { enforceRateLimit } from "@/lib/rate-limit";

const PROVIDER_ALIASES: Record<string, PaymentProvider> = {
  STRIPE: "STRIPE",
  PAYPAL: "PAYPAL",
  CRYPTO: "CRYPTO",
  STEAM_MARKET: "STEAM_MARKET",
  SKRILL: "SKRILL",
  CARD: "STRIPE",
  SKINS: "STEAM_MARKET",
  OTHER: "SKRILL",
};

const ACTIVE_WITHDRAWAL_STATUSES = ["PENDING", "MANUAL_REVIEW", "PROCESSING", "COMPLETED"] as const;

function parsePositiveAmount(raw: unknown) {
  try {
    const value = new Prisma.Decimal(String(raw ?? ""));
    if (!value.isFinite() || value.lte(0)) return null;
    return value.toDecimalPlaces(4);
  } catch {
    return null;
  }
}

function parseProvider(raw: unknown) {
  const value = String(raw ?? "").trim().toUpperCase();
  return PROVIDER_ALIASES[value] ?? null;
}

function serializeMoney(value: Prisma.Decimal | null | undefined) {
  return value?.toString() ?? "0";
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const wallet = await prisma.wallet.findUnique({
    where: { userId: user.id },
    include: {
      holds: { where: { status: "ACTIVE" }, orderBy: { createdAt: "desc" }, take: 100 },
    },
  });
  if (!wallet) return NextResponse.json({ error: "Кошелёк не найден" }, { status: 409 });

  const [transactions, pendingDeposits, pendingWithdrawals] = await Promise.all([
    prisma.transaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, type: true, amount: true, description: true, status: true, currency: true, referenceType: true, referenceId: true, createdAt: true },
    }),
    prisma.deposit.aggregate({ where: { walletId: wallet.id, status: { in: ["PENDING", "PROCESSING"] } }, _sum: { amount: true } }),
    prisma.withdrawal.aggregate({ where: { walletId: wallet.id, status: { in: ["PENDING", "MANUAL_REVIEW", "PROCESSING"] } }, _sum: { amount: true } }),
  ]);

  return NextResponse.json({
    wallet: {
      currency: wallet.currency,
      balance: serializeMoney(wallet.balance),
      lockedBalance: serializeMoney(wallet.lockedBalance),
      bonusBalance: serializeMoney(wallet.bonusBalance),
      pendingDeposits: serializeMoney(pendingDeposits._sum.amount),
      pendingWithdrawals: serializeMoney(pendingWithdrawals._sum.amount),
      activeHolds: wallet.holds.map(hold => ({
        id: hold.id,
        type: hold.type,
        amount: serializeMoney(hold.amount),
        referenceType: hold.referenceType,
        referenceId: hold.referenceId,
        createdAt: hold.createdAt,
      })),
    },
    transactions: transactions.map(transaction => ({
      ...transaction,
      amount: transaction.amount.toString(),
    })),
  });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "").trim().toLowerCase();
  const amount = parsePositiveAmount(body.amount);
  const clientIdempotencyKey = String(request.headers.get("idempotency-key") || body.idempotencyKey || randomUUID()).trim();

  if (!amount) return NextResponse.json({ error: "Некорректная сумма" }, { status: 400 });
  if (!clientIdempotencyKey || clientIdempotencyKey.length > 200) return NextResponse.json({ error: "Idempotency-Key is invalid" }, { status: 400 });

  if (action === "deposit") {
    const provider = parseProvider(body.provider);
    if (!provider) return NextResponse.json({ error: "Неподдерживаемый платёжный провайдер" }, { status: 400 });

    const minDeposit = await getPlatformNumber("MIN_DEPOSIT", 5);
    if (amount.lt(minDeposit)) return NextResponse.json({ error: `Минимальная сумма пополнения — $${minDeposit}` }, { status: 400 });

    const idempotencyKey = `wallet-deposit:${user.id}:${clientIdempotencyKey}`;
    const existing = await prisma.deposit.findUnique({ where: { providerTxId: `request:${idempotencyKey}` } });
    if (existing) return NextResponse.json({ ok: true, idempotent: true, deposit: existing });

    const local = process.env.NODE_ENV !== "production" && process.env.DUELPLAY_LOCAL_TEST_MODE !== "false";
    if (!local && !isPaymentGatewayConfigured()) {
      return NextResponse.json({
        error: "Платёжный шлюз ещё не подключён. Реальные пополнения временно недоступны.",
        errorCode: "PAYMENT_GATEWAY_NOT_CONFIGURED",
      }, { status: 503 });
    }

    if (local) {
      const result = await prisma.$transaction(async tx => {
        await enforceRateLimit(tx, user.id, "DEPOSIT_CREATE", 10, 10 * 60_000);
        const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: user.id } });
        const deposit = await tx.deposit.create({
          data: {
            walletId: wallet.id,
            provider,
            providerTxId: `request:${idempotencyKey}`,
            providerReference: idempotencyKey,
            amount,
            currency: "USD",
            status: "COMPLETED",
            paymentDetails: { localTest: true },
            completedAt: new Date(),
          },
        });
        const credited = await creditWallet(tx, user.id, amount, `deposit:${idempotencyKey}`, "DEPOSIT", `Local test deposit · ${provider}`, deposit.id);
        await grantDepositBonus(tx, user.id, deposit.id, Number(amount), provider);
        await tx.notification.create({
          data: {
            userId: user.id,
            type: "DEPOSIT",
            title: "Deposit completed",
            body: `$${amount.toFixed(2)} added to your DuelPlay balance.`,
            payload: { depositId: deposit.id },
          },
        });
        return { deposit, balance: credited.transaction.balanceAfter.toString() };
      });
      return NextResponse.json({ ok: true, localTest: true, ...result }, { status: 201 });
    }

    // Production deposits intentionally stop here until a concrete provider
    // adapter is connected. We never create a fake PENDING deposit without a
    // real checkout/payment-intent returned by the provider.
    return NextResponse.json({
      error: `Провайдер ${getConfiguredPaymentProvider() ?? provider} ещё не подключён к checkout adapter.`,
      errorCode: "PAYMENT_ADAPTER_NOT_IMPLEMENTED",
    }, { status: 503 });
  }

  if (action === "withdraw") {
    const destination = String(body.destination || "").trim();
    if (!destination) return NextResponse.json({ error: "Укажите реквизиты для вывода" }, { status: 400 });
    if (destination.length > 500) return NextResponse.json({ error: "Реквизиты слишком длинные" }, { status: 400 });

    const provider = parseProvider(body.provider || getConfiguredPaymentProvider() || "");
    if (!provider) return NextResponse.json({ error: "Платёжный провайдер для вывода не настроен", errorCode: "PAYMENT_PROVIDER_NOT_CONFIGURED" }, { status: 503 });

    const idempotencyKey = `wallet-withdraw:${user.id}:${clientIdempotencyKey}`;
    const existing = await prisma.withdrawal.findUnique({ where: { idempotencyKey } });
    if (existing) return NextResponse.json({ ok: true, idempotent: true, withdrawal: existing });

    const maxWithdrawal = await getPlatformNumber("MAX_WITHDRAWAL", 10_000);
    const dailyLimit = await getPlatformNumber("DAILY_WITHDRAWAL_LIMIT", 10_000);
    const kycRequired = (await getPlatformNumber("KYC_REQUIRED_FOR_WITHDRAWALS", 0)) >= 1;
    if (amount.lt(await getPlatformNumber("MIN_WITHDRAWAL", 5))) return NextResponse.json({ error: `Минимальная сумма вывода — $${await getPlatformNumber("MIN_WITHDRAWAL", 5)}` }, { status: 400 });
    if (amount.gt(maxWithdrawal)) return NextResponse.json({ error: `Максимальная сумма одного вывода — $${maxWithdrawal}` }, { status: 400 });

    const local = process.env.NODE_ENV !== "production" && process.env.DUELPLAY_LOCAL_TEST_MODE !== "false";
    if (!local && !isPaymentGatewayConfigured()) {
      return NextResponse.json({ error: "Платёжный шлюз для выводов ещё не подключён.", errorCode: "PAYMENT_GATEWAY_NOT_CONFIGURED" }, { status: 503 });
    }

    try {
      const result = await prisma.$transaction(async tx => {
        await enforceRateLimit(tx, user.id, "WITHDRAWAL_CREATE", 5, 10 * 60_000);
        await assertAccountCanWithdraw(tx, user.id);
        if (kycRequired) {
          const kyc = await tx.kycVerification.findUnique({ where: { userId: user.id }, select: { status: true } });
          if (kyc?.status !== "VERIFIED") throw new Error("KYC_REQUIRED");
        }

        const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: user.id } });
        const dayStart = new Date();
        dayStart.setUTCHours(0, 0, 0, 0);
        const today = await tx.withdrawal.aggregate({
          where: { walletId: wallet.id, createdAt: { gte: dayStart }, status: { in: [...ACTIVE_WITHDRAWAL_STATUSES] } },
          _sum: { amount: true },
        });
        const usedToday = today._sum.amount ?? new Prisma.Decimal(0);
        if (usedToday.plus(amount).gt(dailyLimit)) throw new Error("DAILY_WITHDRAWAL_LIMIT");

        const risk = await assessUserRisk(tx, user.id);
        const withdrawalStatus = risk.score >= 50 ? "MANUAL_REVIEW" : "PENDING";
        const withdrawal = await tx.withdrawal.create({
          data: {
            walletId: wallet.id,
            provider,
            destination,
            amount,
            currency: "USD",
            status: withdrawalStatus,
            idempotencyKey,
            reviewReason: risk.flags.length ? `Risk score ${risk.score}: ${risk.flags.join(", ")}` : null,
          },
        });

        const debit = await debitWallet(tx, user.id, amount, `withdraw:${idempotencyKey}`, "WITHDRAW", "Withdrawal reserve", withdrawal.id);
        if (debit.idempotent) throw new Error("DUPLICATE_WITHDRAWAL");

        await lockWallet(
          tx,
          user.id,
          amount,
          `withdrawal-hold:${withdrawal.id}`,
          "WITHDRAWAL",
          withdrawal.id,
          `Withdrawal reserved · ${withdrawal.id.slice(0, 8)}`,
        );

        await tx.notification.create({
          data: {
            userId: user.id,
            type: "WITHDRAWAL",
            title: "Withdrawal requested",
            body: `Withdrawal of $${amount.toFixed(2)} is ${withdrawalStatus === "MANUAL_REVIEW" ? "under manual review" : "pending"}.`,
            payload: { withdrawalId: withdrawal.id, riskScore: risk.score, manualReview: withdrawalStatus === "MANUAL_REVIEW" },
          },
        });

        return {
          withdrawal,
          balance: debit.transaction.balanceAfter.toString(),
          riskScore: risk.score,
          manualReview: withdrawalStatus === "MANUAL_REVIEW",
        };
      });
      return NextResponse.json({ ok: true, ...result }, { status: 201 });
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "KYC_REQUIRED") return NextResponse.json({ error: "Для вывода средств требуется пройти проверку личности.", errorCode: code }, { status: 403 });
      if (code === "DAILY_WITHDRAWAL_LIMIT") return NextResponse.json({ error: "Превышен дневной лимит вывода средств.", errorCode: code }, { status: 400 });
      if (code === "DUPLICATE_WITHDRAWAL") {
        const duplicateKey = `wallet-withdraw:${user.id}:${clientIdempotencyKey}`;
        const duplicate = await prisma.withdrawal.findUnique({ where: { idempotencyKey: duplicateKey } });
        if (duplicate) return NextResponse.json({ ok: true, idempotent: true, withdrawal: duplicate });
      }
      if (code === "INSUFFICIENT_BALANCE" || code === "INSUFFICIENT") return NextResponse.json({ error: "Недостаточно доступных средств.", errorCode: "INSUFFICIENT_BALANCE" }, { status: 400 });
      if (code === "WITHDRAWALS_FROZEN" || code === "ACCOUNT_DEACTIVATED") return NextResponse.json({ error: "Вывод средств временно заморожен.", errorCode: code }, { status: 403 });
      throw error;
    }
  }

  return NextResponse.json({ error: "Unknown wallet action" }, { status: 400 });
}
