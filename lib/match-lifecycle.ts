import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { awardXp, updateMatchProgress, updateRatingAfterDuel, recordMatchStats } from "@/lib/progression";
import { recalculateTrust } from "@/lib/trust";
import { creditWallet, releaseWalletHold } from "@/lib/wallet";
import { getPlatformNumber } from "@/lib/platform-settings";
import { referralMultiplier } from "@/lib/promotions";
import { recordPlatformLedgerEntry } from "@/lib/finance";
import { MATCH_START_TIMEOUT_MS, MATCH_LIVE_TIMEOUT_MS, MATCH_HEARTBEAT_TIMEOUT_MS } from "@/lib/match-timers";

const START_TIMEOUT_MS = MATCH_START_TIMEOUT_MS;
const CONNECTION_TIMEOUT_MS = MATCH_LIVE_TIMEOUT_MS;
const LIVE_TIMEOUT_MS = MATCH_LIVE_TIMEOUT_MS;
const HEARTBEAT_TIMEOUT_MS = MATCH_HEARTBEAT_TIMEOUT_MS;

function normalizeSteamId(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^\d{17}$/.test(raw)) return raw;
  const steam3 = raw.match(/^\[U:1:(\d+)\]$/);
  if (steam3) {
    try { return String(BigInt("76561197960265728") + BigInt(steam3[1])); } catch { return null; }
  }
  if (/^\d+$/.test(raw)) {
    try { return String(BigInt("76561197960265728") + BigInt(raw)); } catch { return null; }
  }
  return raw;
}

export async function lockMatchForUpdate(tx: Prisma.TransactionClient, matchId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Match" WHERE id = ${matchId}::uuid FOR UPDATE
  `;
  return rows.length === 1;
}

export async function cancelMatchWithRefund(matchId: string, reason: string) {
  return prisma.$transaction(async tx => {
    const locked = await lockMatchForUpdate(tx, matchId);
    if (!locked) return null;
    const match = await tx.match.findUnique({ where: { id: matchId } });
    if (!match || ["FINISHED", "CANCELLED", "DISPUTED"].includes(match.status)) return null;
    const amount = Number(match.betAmount);
    const ids = [match.playerOneId, match.playerTwoId].filter(Boolean) as string[];
    for (const userId of ids) {
      const wallet = await tx.wallet.findUnique({ where: { userId }, select: { id: true } });
      if (!wallet) throw new Error("WALLET");
      const refundKey = `refund:${match.id}:${userId}`;
      const releaseKey = `match-stake-release:refund:${match.id}:${userId}`;
      const existing = await tx.transaction.findUnique({ where: { idempotencyKey: refundKey } });
      if (!existing) {
        await creditWallet(tx, userId, amount, refundKey, "REFUND", reason, match.id);
        await releaseWalletHold(tx, userId, amount, releaseKey, "MATCH_STAKE", match.id, "RELEASED", reason);
      }
      await tx.notification.create({
        data: {
          userId,
          type: "CANCELLATION",
          title: "Match cancelled",
          body: reason.includes("No player connected")
            ? "The match was cancelled because nobody connected to the CS2 server. Your stake was refunded."
            : "The match was cancelled and your stake was refunded.",
          payload: { matchId: match.id, reason },
        },
      });
    }
    return tx.match.update({ where: { id: match.id }, data: { status: "CANCELLED", endedAt: new Date(), startDeadlineAt: null, connectionDeadlineAt: null, liveDeadlineAt: null } });
  });
}

export async function resolveConnectionTimeout(matchId: string, connectedSteamId: string) {
  return prisma.$transaction(async tx => {
    const locked = await lockMatchForUpdate(tx, matchId);
    if (!locked) return null;
    const full = await tx.match.findUnique({
      where: { id: matchId },
      include: { playerOne: { select: { steamId: true } }, playerTwo: { select: { steamId: true } }, gameServer: true },
    });
    if (!full || full.status !== "LIVE" || full.connectionPhaseCompleted || !full.playerTwoId) return null;
    const freshCfg = full.serverConfig && typeof full.serverConfig === "object" && !Array.isArray(full.serverConfig) ? full.serverConfig as Record<string, unknown> : {};
    const freshIds = Array.isArray(freshCfg.connectedSteamIds)
      ? [...new Set(freshCfg.connectedSteamIds.map(normalizeSteamId).filter((v): v is string => Boolean(v)))]
      : [];
    const candidateSteamId = normalizeSteamId(connectedSteamId);
    const playerOneSteamId = normalizeSteamId(full.playerOne.steamId);
    const playerTwoSteamId = normalizeSteamId(full.playerTwo?.steamId);
    const participantSteamIds = new Set(
      [playerOneSteamId, playerTwoSteamId].filter((value): value is string => Boolean(value)),
    );
    if (!candidateSteamId || !participantSteamIds.has(candidateSteamId)) return null;
    // The server-manager is the authoritative source at the timeout moment.
    // Accept its single connected player even if the last persisted heartbeat
    // was one tick behind. If the database already has two players, the
    // connection phase must be considered complete instead of awarding a win.
    if (freshIds.length >= 2) return null;
    if (freshIds.length === 1 && freshIds[0] !== candidateSteamId) return null;
    const winnerId = candidateSteamId === playerOneSteamId ? full.playerOneId : candidateSteamId === playerTwoSteamId ? full.playerTwoId : null;
    if (!winnerId) return null;
    const loserId = winnerId === full.playerOneId ? full.playerTwoId : full.playerOneId;
    const pot = Number(full.betAmount) * 2;
    const fee = Number(full.commission);
    const payout = Number((pot - fee).toFixed(4));
    const wallets = await tx.wallet.findMany({ where: { userId: { in: [winnerId, loserId] } }, select: { userId: true } });
    if (wallets.length !== 2) throw new Error("WALLET");
    const idem = `forfeit:${full.id}`;
    const existing = await tx.transaction.findUnique({ where: { idempotencyKey: idem } });
    if (!existing) {
      const stake = Number(full.betAmount);
      await creditWallet(tx, winnerId, payout, idem, "MATCH_WIN", "Technical win: opponent did not connect", full.id);
      await releaseWalletHold(tx, winnerId, stake, `match-stake-release:forfeit:${full.id}:${winnerId}`, "MATCH_STAKE", full.id, "CONSUMED", "Technical win settlement");
      await releaseWalletHold(tx, loserId, stake, `match-stake-release:forfeit:${full.id}:${loserId}`, "MATCH_STAKE", full.id, "CONSUMED", "Technical loss settlement");
      await recordPlatformLedgerEntry(tx, { type: "MATCH_COMMISSION", amount: fee, referenceType: "MATCH", referenceId: full.id, description: "Match commission · technical win" });
      await awardXp(tx, winnerId, 100); await awardXp(tx, loserId, 25);
      await updateMatchProgress(tx, winnerId, true); await updateMatchProgress(tx, loserId, false);
      await updateRatingAfterDuel(tx, winnerId, loserId);
      await recordMatchStats(tx, full.id, winnerId, { kills: 1, deaths: 0, mapName: full.mapName });
      await recordMatchStats(tx, full.id, loserId, { kills: 0, deaths: 1, mapName: full.mapName });
      const winnerUser = await tx.user.findUnique({ where: { id: winnerId }, select: { referredById: true } });
      const referralRate = await getPlatformNumber("REFERRAL_COMMISSION", 25) / 100;
      const referralAmount = Number((fee * referralRate * await referralMultiplier(tx)).toFixed(4));
      if (winnerUser?.referredById && referralAmount > 0) await creditWallet(tx, winnerUser.referredById, referralAmount, `referral:${full.id}:${winnerUser.referredById}`, "REFERRAL", "Referral commission from technical win", full.id);
      await tx.user.update({ where: { id: winnerId }, data: { reputation: { increment: 15 } } });
      await tx.user.update({ where: { id: loserId }, data: { reputation: { decrement: 10 } } });
      await recalculateTrust(tx, winnerId); await recalculateTrust(tx, loserId);
      await tx.notification.create({ data: { userId: winnerId, type: "TECHNICAL_WIN", title: "Technical win", body: "You won because the opponent did not connect.", payload: { matchId: full.id } } });
      await tx.notification.create({ data: { userId: loserId, type: "LOSS", title: "Match finished", body: "You lost by forfeit after the connection timeout.", payload: { matchId: full.id } } });
    }
    return tx.match.update({ where: { id: full.id }, data: { winnerId, loserId, status: "FINISHED", endedAt: new Date(), connectionPhaseCompleted: true, connectionDeadlineAt: null, liveDeadlineAt: null, serverConfig: { ...freshCfg, state: "FINISHED", resultSource: "CS2_SERVER" } } });
  }, { maxWait: 10000, timeout: 15000 });
}

export async function runMatchWatchdog() {
  const now = new Date();
  const ready = await prisma.match.findMany({ where: { status: "READY", startDeadlineAt: { lte: now } }, select: { id: true } });
  for (const m of ready) await cancelMatchWithRefund(m.id, "START timeout expired");
  const starting = await prisma.match.findMany({ where: { status: "STARTING", startDeadlineAt: { lte: now } }, select: { id: true } });
  for (const m of starting) await cancelMatchWithRefund(m.id, "CS2 server start timeout expired");
  const staleServers = await prisma.gameServer.findMany({
    where: {
      status: { in: ["STARTING", "BUSY"] },
      matchId: { not: null },
      OR: [
        { lastHeartbeat: null },
        { lastHeartbeat: { lt: new Date(now.getTime() - HEARTBEAT_TIMEOUT_MS) } },
      ],
    },
    select: { id: true, matchId: true },
  });
  for (const server of staleServers) {
    if (!server.matchId) continue;
    const match = await prisma.match.findUnique({ where: { id: server.matchId }, select: { status: true } });
    if (!match || ["FINISHED", "CANCELLED", "DISPUTED"].includes(match.status)) {
      await prisma.gameServer.updateMany({ where: { id: server.id, matchId: server.matchId }, data: { status: "OFFLINE", matchId: null, processId: null, stoppedAt: now, lastHeartbeat: null } });
      continue;
    }
    await cancelMatchWithRefund(server.matchId, "CS2 server heartbeat timeout");
    await prisma.gameServer.updateMany({ where: { id: server.id, matchId: server.matchId }, data: { status: "ERROR", matchId: null, processId: null, stoppedAt: now, lastHeartbeat: null } });
  }

  const live = await prisma.match.findMany({ where: { status: "LIVE", liveDeadlineAt: { lte: now }, connectionPhaseCompleted: false }, select: { id: true, serverConfig: true } });
  for (const m of live) {
    const cfg = m.serverConfig && typeof m.serverConfig === "object" && !Array.isArray(m.serverConfig) ? m.serverConfig as Record<string, unknown> : {};
    const ids = Array.isArray(cfg.connectedSteamIds) ? [...new Set(cfg.connectedSteamIds.map(String).filter(Boolean))] : [];
    if (ids.length === 0) await cancelMatchWithRefund(m.id, "No player connected within 5 minutes");
    else if (ids.length === 1) await resolveConnectionTimeout(m.id, ids[0]);
  }
  return { readyCancelled: ready.length, liveProcessed: live.length, staleServersProcessed: staleServers.length };
}

export { START_TIMEOUT_MS, CONNECTION_TIMEOUT_MS, LIVE_TIMEOUT_MS, HEARTBEAT_TIMEOUT_MS };
