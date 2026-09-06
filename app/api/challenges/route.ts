import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { MatchMode } from "@prisma/client";
import { getCurrentUser } from "@/lib/current-user";
import { getPlatformNumber } from "@/lib/platform-settings";
import { debitWallet } from "@/lib/wallet";
import { enforceRateLimit } from "@/lib/rate-limit";
import { assertAbuseGuard } from "@/lib/anti-fraud";
import { isDuelMode, normalizeModeWeaponModifier } from "@/lib/duel-modes";

const ALLOWED_MAPS = new Set(["Mirage", "Dust2", "Ancient", "Train", "Overpass", "Inferno", "Nuke", "Anubis"]);
const ALLOWED_FORMATS = new Set(["1v1"]);
const ALLOWED_WEAPONS = new Set(["", "AK47", "M4A1-S", "M4A4", "AWP", "Desert Eagle", "Knife", "Random"]);
const ACTIVE_MATCH_STATUSES = ["WAITING_FOR_PLAYERS", "READY", "STARTING", "LIVE"] as const;

function challengeError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "RATE_LIMITED") return NextResponse.json({ error: "Too many challenge requests. Try again later." }, { status: 429 });
  if (code === "INSUFFICIENT_BALANCE" || code === "FUNDS") return NextResponse.json({ error: "Insufficient balance." }, { status: 400 });
  if (code === "BUSY") return NextResponse.json({ error: "One of the players is already in an active match." }, { status: 409 });
  if (code === "CLAIMED") return NextResponse.json({ error: "Challenge was already processed." }, { status: 409 });
  if (code === "GAME") return NextResponse.json({ error: "CS2 game configuration is unavailable." }, { status: 503 });
  return NextResponse.json({ error: "Unable to process challenge." }, { status: 500 });
}

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  await prisma.challenge.updateMany({ where: { status: "PENDING", expiresAt: { lte: now } }, data: { status: "EXPIRED" } });
  return NextResponse.json(await prisma.challenge.findMany({
    where: { OR: [{ senderId: me.id }, { receiverId: me.id }] },
    include: { sender: { select: { id: true, nickname: true, avatarUrl: true } }, receiver: { select: { id: true, nickname: true, avatarUrl: true } } },
    orderBy: { createdAt: "desc" },
  }));
}

export async function POST(r: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let b: Record<string, unknown>;
  try { b = await r.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const receiverId = String(b.receiverId || "");
  if (!receiverId || receiverId === me.id) return NextResponse.json({ error: "Invalid receiver" }, { status: 400 });

  const mode = String(b.mode || "SOLO_1V1");
  const mapName = b.mapName ? String(b.mapName) : "Mirage";
  const format = String(b.format || "1v1");
  const weaponModifier = b.weaponModifier ? String(b.weaponModifier) : "";
  const minStake = await getPlatformNumber("MIN_STAKE", 3);
  const maxStake = await getPlatformNumber("MAX_STAKE", 10000);
  const stake = Number(b.stake ?? 0);
  if (!isDuelMode(mode) || !ALLOWED_MAPS.has(mapName) || !ALLOWED_FORMATS.has(format) || !ALLOWED_WEAPONS.has(weaponModifier)) {
    return NextResponse.json({ error: "Invalid challenge configuration" }, { status: 400 });
  }
  const weaponResult = isDuelMode(mode) ? normalizeModeWeaponModifier(mode, weaponModifier) : { ok: false as const, error: "INVALID_MODE" };
  if (!weaponResult.ok) return NextResponse.json({ error: "Weapon modifier does not match duel mode" }, { status: 400 });
  const normalizedWeaponModifier = weaponResult.weaponModifier;
  if (!Number.isFinite(stake) || stake < minStake || stake > maxStake) {
    return NextResponse.json({ error: `Stake must be between $${minStake} and $${maxStake}` }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async tx => {
      await assertAbuseGuard(tx, me.id, "CHALLENGE_CREATE");
      await enforceRateLimit(tx, me.id, "CHALLENGE_CREATE", 20, 60_000);
      // Lock both players before checking limits/duplicates so concurrent requests cannot bypass them.
      const lockedUsers = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "User" WHERE id IN (${me.id}, ${receiverId}) ORDER BY id FOR UPDATE
      `;
      if (lockedUsers.length !== 2) throw new Error("RECEIVER_UNAVAILABLE");

      const receiver = await tx.user.findUnique({ where: { id: receiverId }, select: { id: true, status: true, allowChallenges: true } });
      if (!receiver || receiver.status !== "ACTIVE") throw new Error("RECEIVER_UNAVAILABLE");
      if (!receiver.allowChallenges) throw new Error("CHALLENGES_DISABLED");

      const blocked = await tx.userMute.findFirst({ where: { OR: [{ userId: me.id, mutedUserId: receiverId }, { userId: receiverId, mutedUserId: me.id }] } });
      if (blocked) throw new Error("BLOCKED");

      const active = await tx.challenge.count({ where: { senderId: me.id, status: "PENDING", expiresAt: { gt: new Date() } } });
      if (active >= 10) throw new Error("TOO_MANY_ACTIVE");

      const duplicate = await tx.challenge.findFirst({ where: { senderId: me.id, receiverId, status: "PENDING", expiresAt: { gt: new Date() } } });
      if (duplicate) return { duplicate };

      const row = await tx.challenge.create({ data: { senderId: me.id, receiverId, mode, mapName, stake, format, weaponModifier: normalizedWeaponModifier, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } });
      await tx.notification.create({ data: { userId: receiverId, type: "CHALLENGE", title: "New challenge", body: `${me.nickname} challenged you to a duel.`, payload: { challengeId: row.id } } });
      return { row };
    });

    return NextResponse.json(result.duplicate ?? result.row, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "RECEIVER_UNAVAILABLE") return NextResponse.json({ error: "Player unavailable" }, { status: 404 });
    if (code === "CHALLENGES_DISABLED") return NextResponse.json({ error: "Player does not accept challenges" }, { status: 403 });
    if (code === "BLOCKED") return NextResponse.json({ error: "Player is blocked or muted" }, { status: 403 });
    if (code === "TOO_MANY_ACTIVE") return NextResponse.json({ error: "Too many active challenges" }, { status: 429 });
    return challengeError(error);
  }
}

export async function PATCH(r: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let b: Record<string, unknown>;
  try { b = await r.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const id = String(b.id || "");
  const requestedStatus = String(b.status || "");
  if (!["ACCEPTED", "DECLINED", "CANCELLED"].includes(requestedStatus)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });

  try {
    const result = await prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Challenge" WHERE id = ${id} FOR UPDATE`;
      if (!rows.length) throw new Error("NOT_FOUND");
      const row = await tx.challenge.findUnique({ where: { id } });
      if (!row || ![row.senderId, row.receiverId].includes(me.id)) throw new Error("NOT_FOUND");

      const now = new Date();
      if (row.status === "PENDING" && row.expiresAt <= now) {
        await tx.challenge.updateMany({ where: { id, status: "PENDING" }, data: { status: "EXPIRED" } });
        throw new Error("EXPIRED");
      }

      if (requestedStatus === "DECLINED") {
        if (row.receiverId !== me.id || row.status !== "PENDING") throw new Error("INVALID_TRANSITION");
        const updated = await tx.challenge.updateMany({ where: { id, status: "PENDING", receiverId: me.id }, data: { status: "DECLINED" } });
        if (updated.count !== 1) throw new Error("CLAIMED");
        await tx.notification.create({ data: { userId: row.senderId, type: "CHALLENGE_DECLINED", title: "Challenge declined", body: `${me.nickname} declined your duel challenge.`, payload: { challengeId: id } } });
        return { status: "DECLINED" };
      }

      if (requestedStatus === "CANCELLED") {
        if (row.senderId !== me.id || row.status !== "PENDING") throw new Error("INVALID_TRANSITION");
        const updated = await tx.challenge.updateMany({ where: { id, status: "PENDING", senderId: me.id }, data: { status: "CANCELLED" } });
        if (updated.count !== 1) throw new Error("CLAIMED");
        return { status: "CANCELLED" };
      }

      if (row.receiverId !== me.id || row.status !== "PENDING") throw new Error("INVALID_TRANSITION");
      const claimed = await tx.challenge.updateMany({ where: { id, status: "PENDING", receiverId: me.id }, data: { status: "ACCEPTED" } });
      if (claimed.count !== 1) throw new Error("CLAIMED");

      const players = await tx.user.findMany({ where: { id: { in: [row.senderId, row.receiverId] } }, select: { id: true, status: true } });
      if (players.length !== 2 || players.some(p => p.status !== "ACTIVE")) throw new Error("PLAYER_UNAVAILABLE");
      const existing = await tx.match.findFirst({ where: { OR: [
        { playerOneId: row.senderId, status: { in: [...ACTIVE_MATCH_STATUSES] } },
        { playerTwoId: row.senderId, status: { in: [...ACTIVE_MATCH_STATUSES] } },
        { playerOneId: row.receiverId, status: { in: [...ACTIVE_MATCH_STATUSES] } },
        { playerTwoId: row.receiverId, status: { in: [...ACTIVE_MATCH_STATUSES] } },
      ] } });
      if (existing) throw new Error("BUSY");

      const stake = Number(row.stake);
  if (!Number.isFinite(stake) || stake < 0) throw new Error("FUNDS");
      if (stake > 0) {
        const senderDebit = await debitWallet(tx, row.senderId, stake, `challenge:${row.id}:sender`, "MATCH_BET", `Challenge stake · ${row.id}`, row.id);
        const receiverDebit = await debitWallet(tx, row.receiverId, stake, `challenge:${row.id}:receiver`, "MATCH_BET", `Challenge stake · ${row.id}`, row.id);
        if (senderDebit.idempotent || receiverDebit.idempotent) throw new Error("CLAIMED");
        await tx.wallet.update({ where: { id: senderDebit.transaction.walletId }, data: { lockedBalance: { increment: stake } } });
        await tx.wallet.update({ where: { id: receiverDebit.transaction.walletId }, data: { lockedBalance: { increment: stake } } });
      }

      const game = await tx.game.findUnique({ where: { slug: "cs2" } });
      if (!game) throw new Error("GAME");
      const commissionRate = await getPlatformNumber("COMMISSION_RATE", 10);
      const match = await tx.match.create({ data: {
        gameId: game.id, playerOneId: row.senderId, playerTwoId: row.receiverId, mode: row.mode as MatchMode, format: row.format,
        weaponModifier: row.weaponModifier, mapName: row.mapName || "Mirage", betAmount: stake,
        commission: Number((stake * 2 * (commissionRate / 100)).toFixed(4)), status: "READY", startDeadlineAt: new Date(Date.now() + 120000),
      } });
      await tx.challenge.update({ where: { id: row.id }, data: { matchId: match.id } });
      await tx.notification.create({ data: { userId: row.senderId, type: "CHALLENGE_ACCEPTED", title: "Challenge accepted", body: `${me.nickname} accepted your duel.`, payload: { challengeId: id, matchId: match.id } } });
      return { status: "ACCEPTED", match };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return NextResponse.json({ error: "Challenge not found" }, { status: 404 });
    if (code === "EXPIRED") return NextResponse.json({ error: "Challenge expired" }, { status: 409 });
    if (code === "INVALID_TRANSITION") return NextResponse.json({ error: "Invalid challenge transition" }, { status: 409 });
    if (code === "PLAYER_UNAVAILABLE") return NextResponse.json({ error: "Player unavailable" }, { status: 409 });
    return challengeError(error);
  }
}
