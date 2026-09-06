import { NextRequest, NextResponse } from "next/server";
import { getFeatureFlag } from "@/lib/feature-flags";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { debitWallet } from "@/lib/wallet";
import { getPrimePlan, PRIME_PLANS, primeStatus } from "@/lib/prime";

export async function GET() {
  if (!(await getFeatureFlag("PRIME", false))) return NextResponse.json({ error: "Prime is temporarily disabled", errorCode: "FEATURE_DISABLED" }, { status: 503 });
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sub = await prisma.primeSubscription.findUnique({ where: { userId: me.id } });
  const status = primeStatus(sub?.endsAt);
  return NextResponse.json({
    subscription: sub ? { ...sub, active: status.active } : null,
    status,
    plans: PRIME_PLANS,
  });
}

export async function POST(r: NextRequest) {
  if (!(await getFeatureFlag("PRIME", false))) return NextResponse.json({ error: "Prime is temporarily disabled", errorCode: "FEATURE_DISABLED" }, { status: 503 });
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await r.json().catch(() => ({}));
  const plan = getPrimePlan(body.plan ?? "MONTH");
  if (!plan) return NextResponse.json({ error: "Invalid Prime plan" }, { status: 400 });
  const selected = PRIME_PLANS[plan];
  const rawKey = String(r.headers.get("idempotency-key") || "").trim();
  if (rawKey.length > 200) return NextResponse.json({ error: "Invalid idempotency key" }, { status: 400 });
  const idemKey = rawKey || `auto:${me.id}:${plan}:${crypto.randomUUID()}`;
  const transactionKey = `prime:${me.id}:${idemKey}`;

  try {
    const out = await prisma.$transaction(async tx => {
      const existing = await tx.transaction.findUnique({
        where: { idempotencyKey: transactionKey },
        include: { wallet: { select: { userId: true } } },
      });
      if (existing) {
        if (existing.wallet.userId !== me.id || existing.type !== "PRIME_PURCHASE") {
          throw new Error("IDEMPOTENCY_KEY_REUSED");
        }
        const current = await tx.primeSubscription.findUnique({ where: { userId: me.id } });
        const wallet = await tx.wallet.findUnique({ where: { userId: me.id } });
        return { subscription: current, balance: Number(wallet?.balance ?? existing.balanceAfter), idempotent: true };
      }

      // Serialize subscription extensions as well as the wallet debit. Without this,
      // two concurrent renewals could both read the same endsAt and one extension wins.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${me.id} FOR UPDATE`;
      const now = new Date();
      const current = await tx.primeSubscription.findUnique({ where: { userId: me.id } });
      const currentActive = current ? primeStatus(current.endsAt, now).active : false;
      const start = currentActive && current ? current.endsAt : now;
      const endsAt = new Date(start.getTime() + selected.days * 86_400_000);

      await debitWallet(
        tx,
        me.id,
        selected.price,
        transactionKey,
        "PRIME_PURCHASE",
        `DuelPlay Prime · ${plan}`,
      );

      const subscription = await tx.primeSubscription.upsert({
        where: { userId: me.id },
        update: {
          startsAt: currentActive && current ? current.startsAt : now,
          endsAt,
          active: true,
          tier: "PRIME",
        },
        create: { userId: me.id, startsAt: now, endsAt, active: true, tier: "PRIME" },
      });
      const wallet = await tx.wallet.findUnique({ where: { userId: me.id } });
      return { subscription, balance: Number(wallet?.balance ?? 0), idempotent: false };
    }, { isolationLevel: "Serializable" });

    return NextResponse.json({ ...out, status: primeStatus(out.subscription?.endsAt) });
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    if (message === "INSUFFICIENT_BALANCE") return NextResponse.json({ error: "Insufficient balance" }, { status: 409 });
    if (message === "IDEMPOTENCY_KEY_REUSED") return NextResponse.json({ error: "Idempotency key already belongs to another operation" }, { status: 409 });
    if (message === "INVALID_AMOUNT") return NextResponse.json({ error: "Invalid Prime price" }, { status: 400 });
    return NextResponse.json({ error: "Could not activate Prime" }, { status: 409 });
  }
}
