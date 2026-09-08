import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { awardXp, updateMatchProgress, updateRatingAfterDuel, recordMatchStats } from "@/lib/progression";
import { recalculateTrust } from "@/lib/trust";
import { creditWallet } from "@/lib/wallet";
import { getPlatformNumber } from "@/lib/platform-settings";
import { referralMultiplier } from "@/lib/promotions";
import { MATCH_START_TIMEOUT_MS, MATCH_CONNECTION_TIMEOUT_MS, MATCH_HEARTBEAT_TIMEOUT_MS } from "@/lib/match-timers";

const START_TIMEOUT_MS = MATCH_START_TIMEOUT_MS;
const CONNECTION_TIMEOUT_MS = MATCH_CONNECTION_TIMEOUT_MS;
const HEARTBEAT_TIMEOUT_MS = MATCH_HEARTBEAT_TIMEOUT_MS;

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
      const walletRows = await tx.$queryRaw<Array<{ id: string; lockedBalance: Prisma.Decimal }>>`SELECT id, "lockedBalance" FROM "Wallet" WHERE "userId" = ${userId}::uuid FOR UPDATE`;
      const wallet = walletRows[0];
      if (!wallet) throw new Error("WALLET");
      const idem = `refund:${match.id}:${userId}`;
      const existing = await tx.transaction.findUnique({ where: { idempotencyKey: idem } });
      if (!existing) {
        if (Number(wallet.lockedBalance) < amount) throw new Error("LOCKED_STAKE");
        await creditWallet(tx, userId, amount, idem, "REFUND", reason, match.id);
        await tx.wallet.update({ where: { id: wallet.id }, data: { lockedBalance: { decrement: amount } } });
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
    return tx.match.update({ where: { id: match.id }, data: { status: "CANCELLED", endedAt: new Date(), startDeadlineAt: null, connectionDeadlineAt: null } });
  });
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

  const live = await prisma.match.findMany({ where: { status: "LIVE", connectionDeadlineAt: { lte: now }, connectionPhaseCompleted: false }, select: { id: true, playerOneId: true, playerTwoId: true, serverConfig: true } });
  for (const m of live) {
    const cfg = m.serverConfig && typeof m.serverConfig === "object" && !Array.isArray(m.serverConfig) ? m.serverConfig as Record<string, unknown> : {};
    const ids = Array.isArray(cfg.connectedSteamIds)
      ? cfg.connectedSteamIds.map(String).filter(Boolean)
      : [];
    if (ids.length === 0) {
      await cancelMatchWithRefund(m.id, "No player connected within 10 minutes");
    } else if (ids.length === 1) {
      await prisma.$transaction(async tx => {
        const locked = await lockMatchForUpdate(tx, m.id);
        if (!locked) return;
        const full = await tx.match.findUnique({
          where: { id: m.id },
          include: { playerOne: { select: { steamId: true } }, playerTwo: { select: { steamId: true } } },
        });
        if (!full || full.status !== "LIVE" || full.connectionPhaseCompleted || !full.playerTwoId) return;

        const freshCfg = full.serverConfig && typeof full.serverConfig === "object" && !Array.isArray(full.serverConfig)
          ? full.serverConfig as Record<string, unknown>
          : {};
        const freshIds = Array.isArray(freshCfg.connectedSteamIds)
          ? [...new Set(freshCfg.connectedSteamIds.map(String).filter(Boolean))]
          : [];
        if (freshIds.length !== 1) return;

        const winnerId = freshIds[0] === full.playerOne.steamId
          ? full.playerOneId
          : freshIds[0] === full.playerTwo?.steamId
            ? full.playerTwoId
            : null;
        if (!winnerId) return;
        const loserId = winnerId === full.playerOneId ? full.playerTwoId : full.playerOneId;
        const pot = Number(full.betAmount) * 2;
        const fee = Number(full.commission);
        const payout = Number((pot - fee).toFixed(4));

        const wallets = await tx.$queryRaw<Array<{ id: string; userId: string; lockedBalance: Prisma.Decimal }>>`
          SELECT id, "userId", "lockedBalance" FROM "Wallet"
          WHERE "userId" IN (${Prisma.join([winnerId, loserId])})
          ORDER BY "userId"
          FOR UPDATE
        `;
        const w = wallets.find(row => row.userId === winnerId);
        const l = wallets.find(row => row.userId === loserId);
        if (!w || !l) throw new Error("WALLET");
        const idem = `forfeit:${full.id}`;
        const existing = await tx.transaction.findUnique({ where: { idempotencyKey: idem } });
        if (!existing) {
          const stake = Number(full.betAmount);
          if (Number(w.lockedBalance) < stake || Number(l.lockedBalance) < stake) throw new Error("LOCKED_STAKE");
          await creditWallet(tx, winnerId, payout, idem, "MATCH_WIN", "Technical win: opponent did not connect", full.id);
          await tx.wallet.update({ where: { id: w.id }, data: { lockedBalance: { decrement: stake } } });
          await tx.wallet.update({ where: { id: l.id }, data: { lockedBalance: { decrement: stake } } });
          await awardXp(tx,winnerId,100);
          await awardXp(tx,loserId,25);
          await updateMatchProgress(tx,winnerId,true);
          await updateMatchProgress(tx,loserId,false);
          await updateRatingAfterDuel(tx,winnerId,loserId);
          await recordMatchStats(tx, full.id, winnerId, { kills: 1, deaths: 0, mapName: full.mapName });
          await recordMatchStats(tx, full.id, loserId, { kills: 0, deaths: 1, mapName: full.mapName });
          const winnerUser = await tx.user.findUnique({ where: { id: winnerId }, select: { referredById: true } });
          const referralRate = await getPlatformNumber("REFERRAL_COMMISSION", 25) / 100;
          const referralAmount = Number((fee * referralRate * await referralMultiplier(tx)).toFixed(4));
          if (winnerUser?.referredById && referralAmount > 0) {
            await creditWallet(tx, winnerUser.referredById, referralAmount, `referral:${full.id}:${winnerUser.referredById}`, "REFERRAL", "Referral commission from technical win", full.id);
          }
          await tx.user.update({ where: { id: winnerId }, data: { reputation: { increment: 15 } } });
          await tx.user.update({ where: { id: loserId }, data: { reputation: { decrement: 10 } } });
          await recalculateTrust(tx, winnerId);
          await recalculateTrust(tx, loserId);
          await tx.notification.create({ data: { userId: winnerId, type: "TECHNICAL_WIN", title: "Technical win", body: "You won because the opponent did not connect.", payload: { matchId: full.id } } });
          await tx.notification.create({ data: { userId: loserId, type: "LOSS", title: "Match finished", body: "You lost by forfeit after the connection timeout.", payload: { matchId: full.id } } });
        }
        await tx.match.update({ where: { id: full.id }, data: { winnerId, loserId, status: "FINISHED", endedAt: new Date(), connectionPhaseCompleted: true, connectionDeadlineAt: null } });
      });
    }
  }
  return { readyCancelled: ready.length, liveProcessed: live.length, staleServersProcessed: staleServers.length };
}

export { START_TIMEOUT_MS, CONNECTION_TIMEOUT_MS, HEARTBEAT_TIMEOUT_MS };
