import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { debitWallet } from "@/lib/wallet";
import { grantReward } from "@/lib/rewards";
import { eventPassProgress, refreshEventMissionsForUser } from "@/lib/event-pass";

function jsonError(message: string, status = 400) { return NextResponse.json({ error: message }, { status }); }

function rewardsList(event: any) { return Array.isArray(event.rewards) ? event.rewards.filter((x: any) => x && typeof x === "object") : []; }
function maxRewardLevel(event: any) { return Math.max(1, ...rewardsList(event).map((x: any) => Math.floor(Number(x.level) || 0))); }

export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return jsonError("Unauthorized", 401);
  const eventId = req.nextUrl.searchParams.get("eventId");
  if (!eventId) return jsonError("eventId required");
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return jsonError("Event not found", 404);
  const pass = await prisma.eventPass.findUnique({ where: { eventId_userId: { eventId, userId: me.id } }, include: { claims: { orderBy: { level: "asc" } } } });
  const missions = Array.isArray(event.missions) ? event.missions : [];
  const progress = await prisma.eventMissionProgress.findMany({ where: { eventId, userId: me.id }, orderBy: { missionId: "asc" } });
  return NextResponse.json({ event, pass, claims: pass?.claims ?? [], missions, progress, progressSummary: pass ? eventPassProgress(pass.xp, maxRewardLevel(event)) : null });
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return jsonError("Unauthorized", 401);
  const b = await req.json().catch(() => ({}));
  const eventId = String(b.eventId || "");
  const action = String(b.action || "join");
  if (!eventId) return jsonError("eventId required");

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return jsonError("Event not found", 404);
  const now = new Date();
  const active = event.status !== "CANCELLED" && event.status !== "DRAFT" && event.startsAt <= now && event.endsAt > now;

  if (action === "join" || action === "upgradePremium") {
    if (!active) return jsonError("Event is not active");
    if (!event.eventPass) return jsonError("Event Pass is disabled");
    if (action === "upgradePremium" && !event.premiumPass) return jsonError("Premium Pass is disabled");
    const premium = action === "upgradePremium" || Boolean(b.premium);
    if (premium && !event.premiumPass) return jsonError("Premium Pass is disabled");
    const price = Number(event.premiumPrice);
    if (!Number.isFinite(price) || price < 0) return jsonError("Invalid premium price", 409);

    try {
      const result = await prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('duelplay:event-pass-membership'))`;
        const existing = await tx.eventPass.findUnique({ where: { eventId_userId: { eventId, userId: me.id } } });
        if (existing) {
          if (!premium || existing.premium) return existing;
          if (price > 0) await debitWallet(tx, me.id, price, `event-pass-premium:${eventId}:${me.id}`, "EVENTPASS_PURCHASE", "Premium Event Pass", eventId);
          return tx.eventPass.update({ where: { id: existing.id }, data: { premium: true } });
        }
        if (premium && price > 0) await debitWallet(tx, me.id, price, `event-pass:${eventId}:${me.id}`, "EVENTPASS_PURCHASE", "Premium Event Pass", eventId);
        return tx.eventPass.create({ data: { eventId, userId: me.id, premium } });
      });
      return NextResponse.json(result);
    } catch (e) {
      if (e instanceof Error && e.message === "INSUFFICIENT_BALANCE") return jsonError("Insufficient balance", 400);
      throw e;
    }
  }

  if (action === "refresh") {
    if (!active) return jsonError("Event is not active");
    const pass = await prisma.eventPass.findUnique({ where: { eventId_userId: { eventId, userId: me.id } } });
    if (!pass) return jsonError("Join the Event Pass first");
    await prisma.$transaction(async tx => refreshEventMissionsForUser(tx, me.id, eventId));
    return NextResponse.json({ ok: true });
  }

  if (action === "claim") {
    const level = Math.floor(Number(b.level));
    if (!Number.isInteger(level) || level < 1 || level > 100) return jsonError("Invalid level");
    const result = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('duelplay:event-pass-claim'))`;
      const current = await tx.eventPass.findUnique({ where: { eventId_userId: { eventId, userId: me.id } } });
      if (!current) throw new Error("JOIN_REQUIRED");
      const entry = rewardsList(event).find((x: any) => Number(x.level) === level);
      if (!entry) throw new Error("NO_REWARD");
      if (current.level < level) throw new Error("LEVEL_NOT_REACHED");
      const claimed = await tx.eventPassClaim.findUnique({ where: { eventId_userId_level: { eventId, userId: me.id, level } } });
      if (claimed) return { claimed, already: true };

      const row = await tx.eventPassClaim.create({ data: { eventId, passId: current.id, userId: me.id, level } });
      const free = entry.free && typeof entry.free === "object" ? entry.free : null;
      const premium = entry.premium && typeof entry.premium === "object" ? entry.premium : null;
      if (free) await grantReward(tx, me.id, free, `event-claim:${eventId}:${me.id}:${level}:free`, `Event Pass free reward #${level}`, eventId);
      if (premium) {
        if (!current.premium) throw new Error("PREMIUM_REQUIRED");
        await grantReward(tx, me.id, premium, `event-claim:${eventId}:${me.id}:${level}:premium`, `Event Pass premium reward #${level}`, eventId);
      }
      return { claimed: row, already: false, reward: { free, premium: current.premium ? premium : null } };
    }).catch((e: any) => { throw e; });
    return NextResponse.json(result);
  }
  return jsonError("Unknown action");
}

export const dynamic = "force-dynamic";
