import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { debitWallet } from "@/lib/wallet";
import { getXpBoosterPlan, XP_BOOSTER_PLANS } from "@/lib/xp-booster";

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const now = new Date();
  await prisma.xPBooster.updateMany({ where: { userId: me.id, active: true, endsAt: { lte: now } }, data: { active: false } });
  const boosters = await prisma.xPBooster.findMany({ where: { userId: me.id }, orderBy: { endsAt: "desc" } });
  return NextResponse.json({ plans: XP_BOOSTER_PLANS, boosters });
}

export async function POST(r: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await r.json().catch(() => ({}));
  const selected = getXpBoosterPlan(body.plan);
  if (!selected) return NextResponse.json({ error: "Invalid booster plan" }, { status: 400 });
  const rawIdempotency = String(r.headers.get("idempotency-key") || "").trim();
  const idem = rawIdempotency || randomUUID();
  const idempotencyKey = `xp-booster:${me.id}:${idem}`;

  try {
    const out = await prisma.$transaction(async tx => {
      const existing = await tx.transaction.findUnique({ where: { idempotencyKey } });
      if (existing) return { idempotent: true, balance: Number(existing.balanceAfter), booster: null };

      // Serialize all booster purchases for this user before checking/creating the active booster.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${me.id} FOR UPDATE`;
      const now = new Date();
      await tx.xPBooster.updateMany({ where: { userId: me.id, active: true, endsAt: { lte: now } }, data: { active: false } });
      const active = await tx.xPBooster.findFirst({ where: { userId: me.id, active: true, startsAt: { lte: now }, endsAt: { gt: now } }, orderBy: [{ multiplier: "desc" }, { endsAt: "desc" }] });
      if (active) throw new Error("ACTIVE");

      const startsAt = now;
      const endsAt = new Date(now.getTime() + selected.hours * 60 * 60 * 1000);
      await debitWallet(tx, me.id, selected.price, idempotencyKey, "XP_BOOSTER_PURCHASE", `XP Booster ${selected.multiplier}x ${selected.hours}h`);
      const booster = await tx.xPBooster.create({ data: { userId: me.id, multiplier: selected.multiplier, startsAt, endsAt, active: true } });
      const wallet = await tx.wallet.findUnique({ where: { userId: me.id }, select: { balance: true } });
      return { booster, balance: Number(wallet?.balance ?? 0), idempotent: false };
    }, { isolationLevel: "Serializable" });
    return NextResponse.json(out, { status: out.idempotent ? 200 : 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    if (message === "INSUFFICIENT_BALANCE") return NextResponse.json({ error: "Insufficient balance" }, { status: 409 });
    if (message === "ACTIVE") return NextResponse.json({ error: "An active booster already exists" }, { status: 409 });
    return NextResponse.json({ error: "Could not activate booster" }, { status: 409 });
  }
}
