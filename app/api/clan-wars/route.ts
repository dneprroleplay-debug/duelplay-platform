import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { enforceRateLimit } from "@/lib/rate-limit";
import { CLAN_WAR_RATING_LOSS, CLAN_WAR_RATING_WIN, nextClanWarStatus } from "@/lib/clan-wars";

function jsonError(error: string, status = 400) { return NextResponse.json({ error }, { status }); }

async function lockClanPair(tx: any, ids: string[]) {
  const ordered = [...new Set(ids)].sort();
  for (const id of ordered) await tx.$queryRaw`SELECT id FROM "Clan" WHERE id = ${id} FOR UPDATE`;
}

async function audit(tx: any, userId: string, action: string, targetId: string, payload: unknown, ipAddress: string, userAgent: string) {
  await tx.auditLog.create({ data: {
    userId, action, targetType: "CLAN_WAR", targetId,
    ipAddress, userAgent, payload: payload as any,
  }});
}

export async function GET() {
  const rows = await prisma.clanWar.findMany({
    orderBy: { createdAt: "desc" }, take: 100,
    include: { clanOne: { select: { id: true, name: true, tag: true, rating: true, wins: true, losses: true } }, clanTwo: { select: { id: true, name: true, tag: true, rating: true, wins: true, losses: true } } },
  });
  return NextResponse.json(rows);
}

export async function POST(r: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return jsonError("Unauthorized", 401);
  let body: any;
  try { body = await r.json(); } catch { return jsonError("Invalid JSON"); }
  const action = String(body.action || "create");
  const clanOneId = String(body.clanOneId || "");
  const clanTwoId = String(body.clanTwoId || "");

  if (action !== "create") return jsonError("Use PATCH for clan war state changes");
  if (!clanOneId || !clanTwoId || clanOneId === clanTwoId) return jsonError("Invalid clans");

  const ipAddress = r.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "0.0.0.0";
  const userAgent = r.headers.get("user-agent") || "unknown";
  return prisma.$transaction(async tx => {
    await enforceRateLimit(tx, me.id, "CLAN_WAR_CREATE", 10, 60 * 60 * 1000);
    await lockClanPair(tx, [clanOneId, clanTwoId]);
    const clans = await tx.clan.findMany({ where: { id: { in: [clanOneId, clanTwoId] } }, select: { id: true } });
    if (clans.length !== 2) return jsonError("Clan not found", 404);

    const membership = await tx.clanMember.findFirst({ where: { userId: me.id, clanId: { in: [clanOneId, clanTwoId] }, role: { in: ["LEADER", "OFFICER"] } } });
    if (!membership) return jsonError("Leader or officer required", 403);

    const existing = await tx.clanWar.findFirst({ where: {
      status: { in: ["PENDING", "ACTIVE"] },
      OR: [{ clanOneId, clanTwoId }, { clanOneId: clanTwoId, clanTwoId: clanOneId }],
    } });
    if (existing) return jsonError("These clans already have an active war", 409);

    const war = await tx.clanWar.create({ data: { clanOneId, clanTwoId, status: "PENDING" } });
    await audit(tx, me.id, "CLAN_WAR_CREATE", war.id, { clanOneId, clanTwoId }, ipAddress, userAgent);
    return NextResponse.json(war, { status: 201 });
  });
}

export async function PATCH(r: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return jsonError("Unauthorized", 401);
  let body: any;
  try { body = await r.json(); } catch { return jsonError("Invalid JSON"); }
  const action = String(body.action || "");
  const id = String(body.id || "");
  if (!id || !["start", "finish", "cancel"].includes(action)) return jsonError("Invalid action");
  const ipAddress = r.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "0.0.0.0";
  const userAgent = r.headers.get("user-agent") || "unknown";

  return prisma.$transaction(async tx => {
    const war = await tx.clanWar.findUnique({ where: { id } });
    if (!war) return jsonError("Clan war not found", 404);
    await lockClanPair(tx, [war.clanOneId, war.clanTwoId]);
    const lockedWar = await tx.clanWar.findUnique({ where: { id } });
    if (!lockedWar) return jsonError("Clan war not found", 404);

    const membership = await tx.clanMember.findFirst({ where: {
      userId: me.id, clanId: { in: [lockedWar.clanOneId, lockedWar.clanTwoId] }, role: { in: ["LEADER", "OFFICER"] },
    } });
    if (!membership) return jsonError("Leader or officer required", 403);

    const next = nextClanWarStatus(action as "start" | "finish" | "cancel", lockedWar.status);
    if (!next) return jsonError("Invalid clan war state transition", 409);

    if (action === "finish") {
      const winnerClanId = String(body.winnerClanId || "");
      if (![lockedWar.clanOneId, lockedWar.clanTwoId].includes(winnerClanId)) return jsonError("Invalid winner clan", 400);
      const loserClanId = winnerClanId === lockedWar.clanOneId ? lockedWar.clanTwoId : lockedWar.clanOneId;
      const winner = await tx.clan.findUnique({ where: { id: winnerClanId }, select: { rating: true } });
      const loser = await tx.clan.findUnique({ where: { id: loserClanId }, select: { rating: true } });
      if (!winner || !loser) return jsonError("Clan not found", 404);
      await tx.clan.update({ where: { id: winnerClanId }, data: { wins: { increment: 1 }, rating: { increment: CLAN_WAR_RATING_WIN } } });
      await tx.clan.update({ where: { id: loserClanId }, data: { losses: { increment: 1 }, rating: { decrement: Math.min(CLAN_WAR_RATING_LOSS, loser.rating) } } });
      await tx.clanWar.update({ where: { id }, data: { status: "FINISHED", winnerClanId } });
      await audit(tx, me.id, "CLAN_WAR_FINISH", id, { winnerClanId, loserClanId, ratingDelta: CLAN_WAR_RATING_WIN }, ipAddress, userAgent);
    } else {
      await tx.clanWar.update({ where: { id }, data: { status: next } });
      await audit(tx, me.id, `CLAN_WAR_${action.toUpperCase()}`, id, { status: next }, ipAddress, userAgent);
    }

    return NextResponse.json(await tx.clanWar.findUnique({ where: { id }, include: {
      clanOne: { select: { id: true, name: true, tag: true, rating: true, wins: true, losses: true } },
      clanTwo: { select: { id: true, name: true, tag: true, rating: true, wins: true, losses: true } },
    }}));
  }).catch(e => {
    if (e instanceof Error && e.message === "RATE_LIMITED") return jsonError("Too many clan war actions. Try again later.", 429);
    console.error("Clan war API error", e);
    return jsonError("Clan war operation failed", 500);
  });
}
