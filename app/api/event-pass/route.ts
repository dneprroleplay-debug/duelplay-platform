import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { debitWallet, creditWallet } from "@/lib/wallet";
import { grantReward } from "@/lib/rewards";

function rewardAt(rewards: unknown, level: number, premium: boolean) {
  if (!Array.isArray(rewards)) return null;
  const row = rewards.find((x: any) => Number(x?.level) === level);
  if (!row) return null;
  return premium ? (row.premium ?? row.free ?? row.reward ?? null) : (row.free ?? row.reward ?? null);
}
function values(value: unknown) {
  const r = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return { xp: Math.max(0, Math.floor(Number(r.xp || 0))), balance: Math.max(0, Number(r.balance || r.coins || 0)) };
}
async function getEvent(id: string) {
  const now = new Date();
  return prisma.event.findFirst({ where: { id, status: "ACTIVE", startsAt: { lte: now }, endsAt: { gte: now } } });
}
export async function GET(r: NextRequest) {
  const me = await getCurrentUser(); if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(r.url).searchParams.get("eventId") || ""; if (!id) return NextResponse.json({ error: "eventId required" }, { status: 400 });
  const event = await getEvent(id); if (!event) return NextResponse.json({ error: "Event not found or inactive" }, { status: 404 });
  const pass = await prisma.eventPass.upsert({ where: { eventId_userId: { eventId: id, userId: me.id } }, update: {}, create: { eventId: id, userId: me.id } });
  const claims = await prisma.eventPassClaim.findMany({ where: { eventId: id, userId: me.id }, orderBy: { level: "asc" }, select: { level: true, claimedAt: true } });
  return NextResponse.json({ event, pass, claims, rewards: event.rewards });
}
export async function POST(r: NextRequest) {
  const me = await getCurrentUser(); if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await r.json().catch(() => ({})); const eventId = String(b.eventId || ""); const action = String(b.action || "");
  const event = await getEvent(eventId); if (!event) return NextResponse.json({ error: "Event not found or inactive" }, { status: 404 });
  try {
    if (action === "premium") {
      if (!event.premiumPass) return NextResponse.json({ error: "Premium pass is not available" }, { status: 409 });
      const idem = String(r.headers.get("idempotency-key") || `eventpass:${eventId}:${me.id}:premium`);
      const pass = await prisma.$transaction(async tx => {
        const current = await tx.eventPass.upsert({ where: { eventId_userId: { eventId, userId: me.id } }, update: {}, create: { eventId, userId: me.id } });
        if (current.premium) return current;
        if (Number(event.premiumPrice) > 0) await debitWallet(tx, me.id, Number(event.premiumPrice), `eventpass:${idem}`, "EVENTPASS_PURCHASE", `Event Pass Premium · ${event.name}`, event.id);
        return tx.eventPass.update({ where: { id: current.id }, data: { premium: true } });
      });
      return NextResponse.json(pass);
    }
    if (action === "claim") {
      const level = Math.max(1, Math.floor(Number(b.level || 0)));
      const idem = String(r.headers.get("idempotency-key") || `eventpass:${eventId}:${me.id}:claim:${level}`);
      const out = await prisma.$transaction(async tx => {
        const current = await tx.eventPass.upsert({ where: { eventId_userId: { eventId, userId: me.id } }, update: {}, create: { eventId, userId: me.id } });
        if (current.level < level) throw new Error("LEVEL_LOCKED");
        const rawReward = rewardAt(event.rewards, level, current.premium);
        const reward = values(rawReward);
        const hasItemReward = !!(rawReward && typeof rawReward === "object" && (((rawReward as any).case) || (rawReward as any).caseId || (rawReward as any).caseSlug || (rawReward as any).cosmetic || (rawReward as any).cosmeticItemId));
        if (!reward.xp && !reward.balance && !hasItemReward) throw new Error("NO_REWARD");
        const existing = await tx.eventPassClaim.findUnique({ where: { eventId_userId_level: { eventId, userId: me.id, level } } });
        if (existing) return { idempotent: true, balance: null, reward, claimedAt: existing.claimedAt };
        const granted = await grantReward(tx, me.id, rewardAt(event.rewards, level, current.premium), `eventpass-claim:${idem}`, `Event Pass reward · ${event.name} · ${level}`, event.id);
        const balance = granted.balanceAfter;
        const claim = await tx.eventPassClaim.create({ data: { eventId, passId: current.id, userId: me.id, level } });
        return { idempotent: false, balance, reward, claimedAt: claim.claimedAt };
      });
      return NextResponse.json({ ok: true, ...out });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    const error = m === "LEVEL_LOCKED" ? "Level is not unlocked" : m === "NO_REWARD" ? "No reward configured" : m === "INSUFFICIENT_BALANCE" ? "Insufficient balance" : "Could not process Event Pass";
    return NextResponse.json({ error }, { status: 409 });
  }
}
