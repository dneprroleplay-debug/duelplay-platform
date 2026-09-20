import { NextRequest, NextResponse } from "next/server";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { creditWallet, releaseWalletHold } from "@/lib/wallet";

const MAX_PAYLOAD_BYTES = 256 * 1024;

function safeEqual(signature: string, expected: string) {
  const normalized = signature.trim().toLowerCase().replace(/^sha256=/, "");
  if (!/^[a-f0-9]{64}$/.test(normalized)) return false;
  return timingSafeEqual(Buffer.from(normalized, "hex"), Buffer.from(expected, "hex"));
}

function asAmount(value: unknown) {
  try {
    const amount = new Prisma.Decimal(String(value ?? ""));
    if (!amount.isFinite() || amount.lte(0)) return null;
    return amount.toDecimalPlaces(4);
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: rawProvider } = await params;
  const provider = rawProvider.trim().toUpperCase();
  const configuredProvider = String(process.env.DUELPLAY_PAYMENT_PROVIDER || "").trim().toUpperCase();
  const secret = process.env.DUELPLAY_PAYMENT_WEBHOOK_SECRET || "";
  if (!secret || !configuredProvider || provider !== configuredProvider) {
    return NextResponse.json({ error: "Payment provider not configured" }, { status: 503 });
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_PAYLOAD_BYTES) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  const signature = request.headers.get("x-duelplay-signature") || request.headers.get("x-signature") || "";
  const expected = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  if (!safeEqual(signature, expected)) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  let payload: Prisma.InputJsonObject;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("INVALID_PAYLOAD");
    payload = parsed as Prisma.InputJsonObject;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const externalId = String(request.headers.get("x-event-id") || payload.eventId || payload.event_id || payload.id || "").trim().slice(0, 255) || createHash("sha256").update(raw, "utf8").digest("hex");
  const eventType = String(payload.eventType || payload.event || payload.type || "").trim().toUpperCase().slice(0, 255);
  const reference = String(payload.reference || payload.providerReference || payload.merchantReference || "").trim();
  const transactionId = String(payload.transactionId || payload.providerTxId || "").trim();
  const amount = asAmount(payload.amount);
  const currency = String(payload.currency || "USD").trim().toUpperCase();

  if (!eventType || !reference || !amount || currency !== "USD") {
    return NextResponse.json({ error: "Invalid payment event" }, { status: 400 });
  }

  let rowId: string | null = null;
  try {
    const existing = await prisma.webhookEvent.findUnique({ where: { provider_externalId: { provider, externalId } } });
    if (existing?.status === "PROCESSED") return NextResponse.json({ ok: true, idempotent: true, id: existing.id });

    const row = existing ?? await prisma.webhookEvent.create({
      data: { provider, eventType, externalId, payload, status: "RECEIVED", attempts: 1 },
    });
    rowId = row.id;
    if (existing) {
      await prisma.webhookEvent.update({ where: { id: existing.id }, data: { status: "RECEIVED", attempts: { increment: 1 }, errorMessage: null, payload, eventType } });
    }

    await prisma.$transaction(async tx => {
      const deposit = await tx.deposit.findFirst({
        where: { provider: provider as never, OR: [{ providerReference: reference }, { providerTxId: reference }, ...(transactionId ? [{ providerTxId: transactionId }] : [])] },
      });

      const withdrawal = await tx.withdrawal.findFirst({
        where: { OR: [{ providerReference: reference }, ...(transactionId ? [{ providerTxId: transactionId }] : [])] },
      });

      const success = ["DEPOSIT_COMPLETED", "PAYMENT_COMPLETED", "COMPLETED", "SUCCESS", "PAID"].includes(eventType);
      const failed = ["DEPOSIT_FAILED", "PAYMENT_FAILED", "FAILED", "EXPIRED", "REJECTED"].includes(eventType);

      if (deposit && success && ["PENDING", "PROCESSING"].includes(deposit.status)) {
        if (!deposit.amount.eq(amount)) throw new Error("DEPOSIT_AMOUNT_MISMATCH");
        await tx.deposit.update({ where: { id: deposit.id }, data: { status: "COMPLETED", providerTxId: transactionId || deposit.providerTxId, completedAt: new Date(), failureReason: null } });
        await creditWallet(tx, (await tx.wallet.findUniqueOrThrow({ where: { id: deposit.walletId }, select: { userId: true } })).userId, amount, `deposit-webhook:${deposit.id}`, "DEPOSIT", "Payment provider deposit completed", deposit.id);
      } else if (deposit && failed && ["PENDING", "PROCESSING"].includes(deposit.status)) {
        await tx.deposit.update({ where: { id: deposit.id }, data: { status: eventType === "EXPIRED" ? "EXPIRED" : "FAILED", failureReason: String(payload.reason || payload.failureReason || "Payment provider reported failure").slice(0, 500) } });
      } else if (withdrawal && success && ["PENDING", "MANUAL_REVIEW", "PROCESSING"].includes(withdrawal.status)) {
        if (!withdrawal.amount.eq(amount)) throw new Error("WITHDRAWAL_AMOUNT_MISMATCH");
        const wallet = await tx.wallet.findUniqueOrThrow({ where: { id: withdrawal.walletId }, select: { userId: true } });
        await releaseWalletHold(tx, wallet.userId, amount, `withdrawal-release:${withdrawal.id}:completed`, "WITHDRAWAL", withdrawal.id, "CONSUMED", "Payment provider payout completed");
        await tx.withdrawal.update({ where: { id: withdrawal.id }, data: { status: "COMPLETED", providerTxId: transactionId || null, completedAt: new Date(), failureReason: null } });
      } else if (withdrawal && failed && ["PENDING", "MANUAL_REVIEW", "PROCESSING"].includes(withdrawal.status)) {
        if (!withdrawal.amount.eq(amount)) throw new Error("WITHDRAWAL_AMOUNT_MISMATCH");
        const wallet = await tx.wallet.findUniqueOrThrow({ where: { id: withdrawal.walletId }, select: { userId: true } });
        await creditWallet(tx, wallet.userId, amount, `withdrawal-refund:${withdrawal.id}`, "REFUND", "Payment provider payout failed", withdrawal.id);
        await releaseWalletHold(tx, wallet.userId, amount, `withdrawal-release:${withdrawal.id}:failed`, "WITHDRAWAL", withdrawal.id, "RELEASED", "Payment provider payout failed");
        await tx.withdrawal.update({ where: { id: withdrawal.id }, data: { status: eventType === "REJECTED" ? "REJECTED" : "FAILED", providerTxId: transactionId || null, failureReason: String(payload.reason || payload.failureReason || "Payment provider reported failure").slice(0, 500) } });
      } else if (!deposit && !withdrawal) {
        throw new Error("PAYMENT_REFERENCE_NOT_FOUND");
      }

      await tx.webhookEvent.update({ where: { id: row.id }, data: { status: "PROCESSED", processedAt: new Date() } });
    });

    return NextResponse.json({ ok: true, id: row.id });
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2002") {
      const existing = await prisma.webhookEvent.findUnique({ where: { provider_externalId: { provider, externalId } } });
      if (existing?.status === "PROCESSED") return NextResponse.json({ ok: true, idempotent: true, id: existing.id });
      rowId = existing?.id ?? rowId;
    }
    if (rowId) {
      await prisma.webhookEvent.update({ where: { id: rowId }, data: { status: "FAILED", errorMessage: String(error instanceof Error ? error.message : "Unknown webhook processing error").slice(0, 500) } }).catch(() => {});
    }
    console.error("payment webhook failed", error);
    return NextResponse.json({ error: "Payment webhook processing failed" }, { status: 500 });
  }
}
