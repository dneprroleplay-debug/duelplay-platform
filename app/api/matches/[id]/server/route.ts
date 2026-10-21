import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { isServerManagerRequest } from "@/app/api/server-manager/auth";
import { creditWallet, releaseWalletHold } from "@/lib/wallet";
import { lockMatchForUpdate, resolveConnectionTimeout, cancelMatchWithRefund } from "@/lib/match-lifecycle";
import { deadlineFromNow, MATCH_LIVE_TIMEOUT_MS } from "@/lib/match-timers";
import { enforceIpRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-meta";
import { withDemoPolicyTransaction } from "@/lib/demo-policy";
import type { DemoPolicyTransactionContext } from "@/lib/demo-policy";

function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

async function setGameProcessMetadata(tx: Prisma.TransactionClient, serverId: string, status: "STARTING" | "READY" | "ERROR" | "STOPPING" | "STOPPED", processId: number | null = null) {
  const server = await tx.gameServer.findUnique({ where: { id: serverId }, select: { metadata: true } });
  if (!server) return;
  await tx.gameServer.update({ where: { id: serverId }, data: { metadata: { ...asRecord(server.metadata), gameProcessReady: status === "READY", gameProcessStatus: status, gameProcessPid: status === "READY" ? processId : null } } });
}

async function markGameProcessStopped(tx: Prisma.TransactionClient, serverId: string, matchId: string) {
  await tx.gameServer.updateMany({ where: { id: serverId, matchId }, data: { status: "OFFLINE", matchId: null, processId: null, stoppedAt: new Date(), lastHeartbeat: null } });
  await setGameProcessMetadata(tx, serverId, "STOPPED");
}

async function refundAndCancel(tx: Prisma.TransactionClient, match: Prisma.MatchGetPayload<{ include: { gameServer: true } }>, reason = "Match server failed/stopped before completion", demoContext?: Pick<DemoPolicyTransactionContext, "demo" | "policy">) {
  const amount = Number(match.betAmount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("INVALID_AMOUNT");
  const cancelledAt = new Date();

  if (match.economyMode === "DEMO") {
    if (!demoContext) throw new Error("DEMO_TRANSACTION_REQUIRED");
    if (match.status !== "LIVE" && match.playerTwoId) await demoContext.policy.releaseDemoMatchReservation(match.id);
    for (const uid of [match.playerOneId, match.playerTwoId].filter(Boolean).sort() as string[]) {
      await demoContext.demo.closeDemoWalletHold(uid, match.id, match.betAmount.toString(), `demo:server-refund:${match.id}:${uid}`, "RELEASED");
      await tx.notification.create({ data: { userId: uid, type: "CANCELLATION", title: "DEMO match cancelled", body: "The virtual match was cancelled and your Demo Credits were refunded.", payload: { matchId: match.id, reason, cancelledBy: "server-manager", cancelledAt: cancelledAt.toISOString(), economyMode: "DEMO" } } });
    }
    await tx.match.update({ where: { id: match.id }, data: { status: "CANCELLED", endedAt: cancelledAt, serverConfig: { ...asRecord(match.serverConfig), state: "FAILED", connectUrl: "" } } });
    return;
  }

  for (const uid of [match.playerOneId, match.playerTwoId].filter(Boolean) as string[]) {
    const idem = `refund:${match.id}:${uid}`;
    const existing = await tx.transaction.findUnique({ where: { idempotencyKey: idem } });

    const wallet = await tx.wallet.findUnique({ where: { userId: uid }, select: { id: true } });
    if (!wallet) throw new Error("WALLET");

    if (!existing) {
      await creditWallet(tx, uid, amount, idem, "REFUND", reason, match.id);
      await releaseWalletHold(tx, uid, amount, `match-stake-release:server-refund:${match.id}:${uid}`, "MATCH_STAKE", match.id, "RELEASED", reason);
    }

    await tx.notification.create({
      data: {
        userId: uid,
        type: "CANCELLATION",
        title: "Match cancelled",
        body: reason.toLowerCase().includes("nobody connected") || reason.toLowerCase().includes("no player connected")
          ? "The match was automatically cancelled because nobody connected to the CS2 server in time. Your stake was refunded."
          : "The match was automatically cancelled because the CS2 server could not continue. Your stake was refunded.",
        payload: { matchId: match.id, reason, cancelledBy: "server-manager", cancelledAt: cancelledAt.toISOString() },
      },
    });
  }

  await tx.match.update({
    where: { id: match.id },
    data: {
      status: "CANCELLED",
      endedAt: cancelledAt,
      serverConfig: { ...asRecord(match.serverConfig), state: "FAILED", connectUrl: "" },
    },
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ip = getClientIp(request);
    await prisma.$transaction(tx => enforceIpRateLimit(tx, ip, "SERVER_MANAGER_STATE", 300, 10 * 60_000));
  } catch (error) {
    if (error instanceof Error && error.message === "RATE_LIMITED") return NextResponse.json({ error: "Server manager rate limit exceeded" }, { status: 429 });
    throw error;
  }
  if (!isServerManagerRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await request.json();
  const action = String(body.action ?? "");
  const serverId = String(body.serverId ?? "");
  try {
    if (action === "ready") {
      const match = await withDemoPolicyTransaction(async ({ db: tx, policy }) => {
        const locked = await lockMatchForUpdate(tx, id);
        if (!locked) throw new Error("NOT_FOUND");
        const match = await tx.match.findUnique({ where: { id }, include: { gameServer: true } });
        if (!match || !match.gameServer || match.gameServer.id !== serverId) throw new Error("NOT_FOUND");
        if (match.status === "LIVE") {
          if (match.economyMode === "DEMO") await policy.confirmDemoMatchLive(id, match.startedAt ?? new Date());
          return match;
        }
        if (!["READY","STARTING"].includes(match.status)) throw new Error("INVALID_STATUS");
        const startedAt = new Date();
        if (match.economyMode === "DEMO") await policy.confirmDemoMatchLive(id, startedAt);
        const port = Number(body.port ?? match.gameServer.port);
        const host = String(body.host ?? match.gameServer.host);
        const processId = Number.isInteger(body.processId) ? Number(body.processId) : null;
        await tx.gameServer.update({ where: { id: serverId }, data: { status: "BUSY", host, port, processId, startedAt, lastHeartbeat: startedAt } });
        await setGameProcessMetadata(tx, serverId, "READY", processId);
        const cfg = asRecord(match.serverConfig);
        const live = await tx.match.update({ where: { id }, data: { status: "LIVE", startedAt, startDeadlineAt: null, connectionDeadlineAt: null,
        liveDeadlineAt: deadlineFromNow(MATCH_LIVE_TIMEOUT_MS, startedAt.getTime()),
        connectionPhaseCompleted: false,
        serverConfig: { ...cfg, state: "READY", serverId, connectUrl: `steam://connect/${host}:${port}` } } });
        // Both players must learn that the server is live. The transition into
        // LIVE happens exactly once (the early return above short-circuits any
        // repeated "ready" call), so the notification cannot be duplicated.
        const demoEconomy = match.economyMode === "DEMO";
        for (const userId of [match.playerOneId, match.playerTwoId].filter(Boolean) as string[]) {
          await tx.notification.create({
            data: {
              userId,
              type: "MATCH_STARTED",
              status: "UNREAD",
              title: demoEconomy ? "DEMO match started" : "Match started",
              body: demoEconomy
                ? "The CS2 server is live. Connect to start the virtual duel; your real balance was not changed."
                : "The CS2 server is live. Connect to start the duel.",
              payload: { matchId: id, ...(demoEconomy ? { economyMode: "DEMO" } : {}) },
            },
          });
        }
        return live;
      });
      return NextResponse.json({ ok: true, match });
    }

    if (action === "referee-event") {
      const sequence = Number(body.sequence);
      const type = String(body.type ?? "").trim();
      const steamId = body.steamId ? String(body.steamId).trim() : null;
      const payload = body.payload && typeof body.payload === "object" ? body.payload : null;
      const allowedTypes = new Set([
        "MATCH_OBSERVED",
        "PLAYER_CONNECTED",
        "PLAYER_DISCONNECTED",
        "PLAYER_RECONNECTED",
        "ROUND_STARTED",
        "ROUND_ENDED",
        "PLAYER_STATS_CHANGED",
        "PLAYER_ROUND_STATS_CHANGED",
        "PLAYER_WEAPON_CHANGED",
        "MATCH_PHASE_CHANGED",
      ]);
      if (!Number.isInteger(sequence) || sequence < 1 || !type || !allowedTypes.has(type)) {
        return NextResponse.json({ error: "Invalid referee event" }, { status: 400 });
      }
      if (steamId && !/^\d{17}$/.test(steamId)) {
        return NextResponse.json({ error: "Invalid referee SteamID" }, { status: 400 });
      }
      if (JSON.stringify(payload ?? null).length > 20000) {
        return NextResponse.json({ error: "Referee payload is too large" }, { status: 413 });
      }

      const result = await prisma.$transaction(async tx => {
        const match = await tx.match.findUnique({
          where: { id },
          select: {
            status: true,
            gameServer: { select: { id: true, matchId: true } },
            playerOne: { select: { steamId: true } },
            playerTwo: { select: { steamId: true } },
          },
        });
        if (!match || !match.gameServer || match.gameServer.id !== serverId) throw new Error("SERVER_NOT_ASSIGNED");
        if (match.status !== "LIVE") throw new Error("STALE_MATCH");
        const participantIds = new Set([match.playerOne?.steamId, match.playerTwo?.steamId].filter(Boolean));
        if (steamId && !participantIds.has(steamId)) throw new Error("INVALID_PARTICIPANT");

        const existing = await tx.matchRefereeEvent.findUnique({ where: { matchId_sequence: { matchId: id, sequence } } });
        if (existing) return { duplicate: true, event: existing };
        const event = await tx.matchRefereeEvent.create({ data: { matchId: id, sequence, type, steamId, payload: payload as Prisma.InputJsonValue | undefined } });
        return { duplicate: false, event };
      });
      return NextResponse.json({ ok: true, duplicate: result.duplicate, event: result.event });
    }

    if (action === "heartbeat") {
      const connectedSteamIds: string[] = Array.isArray(body.connectedSteamIds)
        ? body.connectedSteamIds
            .map((value: unknown) => String(value).trim())
            .filter(Boolean)
        : [];

      const connectionPhaseCompleted =
        body.connectionPhaseCompleted === true;
      const refereeState = body.refereeState && typeof body.refereeState === "object" && !Array.isArray(body.refereeState)
        ? body.refereeState
        : null;

      await prisma.$transaction(async tx => {
        const match = await tx.match.findUnique({
          where: { id },
          select: {
            id: true,
            status: true,
            serverConfig: true,
            playerOne: { select: { steamId: true } },
            playerTwo: { select: { steamId: true } },
          },
        });

        if (!match || match.status !== "LIVE") throw new Error("STALE_MATCH");

        const serverUpdate = await tx.gameServer.updateMany({
          where: { id: serverId, matchId: id },
          data: {
            lastHeartbeat: new Date(),
            status: "BUSY",
          },
        });
        if (serverUpdate.count !== 1) throw new Error("SERVER_NOT_ASSIGNED");
        await setGameProcessMetadata(tx, serverId, "READY");

        const cfg = asRecord(match.serverConfig);
        const normalizeSteamId = (value: unknown): string | null => {
          const raw = String(value ?? '').trim();
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
        };
        const participantSteamIds = new Set(
          [match.playerOne?.steamId, match.playerTwo?.steamId]
            .map(normalizeSteamId)
            .filter((value): value is string => Boolean(value)),
        );
        const normalizedConnectedSteamIds = connectedSteamIds
          .map(normalizeSteamId)
          .filter((value): value is string => Boolean(value));
        const validConnectedSteamIds = [...new Set<string>(normalizedConnectedSteamIds)]
          .filter((steamId: string) => participantSteamIds.has(steamId));
        const bothParticipantsConnected = validConnectedSteamIds.length >= 2 && participantSteamIds.size >= 2;
        const phaseDone =
          connectionPhaseCompleted && bothParticipantsConnected ||
          bothParticipantsConnected ||
          cfg.connectionPhaseCompleted === true;

        await tx.match.update({
          where: { id },
          data: {
            connectionPhaseCompleted: phaseDone,
            liveDeadlineAt: phaseDone ? null : undefined,
            serverConfig: {
              ...cfg,
              connectedSteamIds: validConnectedSteamIds,
              connectionPhaseCompleted: phaseDone,
              ...(refereeState ? { refereeState } : {}),
            },
          },
        });
      });

      const due = await prisma.match.findUnique({
        where: { id },
        select: { status: true, liveDeadlineAt: true, connectionPhaseCompleted: true, serverConfig: true },
      });
      if (due?.status === "LIVE" && !due.connectionPhaseCompleted && due.liveDeadlineAt && due.liveDeadlineAt.getTime() <= Date.now()) {
        const cfg = due.serverConfig && typeof due.serverConfig === "object" && !Array.isArray(due.serverConfig) ? due.serverConfig as Record<string, unknown> : {};
        const ids = Array.isArray(cfg.connectedSteamIds) ? [...new Set(cfg.connectedSteamIds.map(String).filter(Boolean))] : [];
        if (ids.length >= 2) {
          return NextResponse.json({ ok: true, phaseCompleted: true });
        } else if (ids.length === 1) {
          const resolved = await resolveConnectionTimeout(id, ids[0]);
          if (resolved?.status === "FINISHED") {
            await prisma.$transaction(tx => markGameProcessStopped(tx, serverId, id));
          }
        } else if (ids.length === 0) {
          await cancelMatchWithRefund(id, "No player connected within 5 minutes");
          await prisma.$transaction(tx => markGameProcessStopped(tx, serverId, id));
        }
      }
      return NextResponse.json({ ok: true });
    }

    if (action === "connection-timeout") {
      const winnerSteamId = String(body.connectedSteamId ?? "").trim();
      if (!winnerSteamId) return NextResponse.json({ error: "Connected player is required" }, { status: 400 });
      const result = await resolveConnectionTimeout(id, winnerSteamId);
      if (result?.status === "FINISHED") {
        await prisma.$transaction(tx => markGameProcessStopped(tx, serverId, id));
        return NextResponse.json({ ok: true, match: result, technicalWin: true });
      }
      const state = await prisma.match.findUnique({ where: { id }, select: { status: true, winnerId: true } });
      if (state?.status === "FINISHED" && state.winnerId) {
        await prisma.$transaction(tx => markGameProcessStopped(tx, serverId, id));
        return NextResponse.json({ ok: true, technicalWin: true, alreadyResolved: true });
      }
      return NextResponse.json({ error: "Connection timeout could not be resolved" }, { status: 409 });
    }

    if (action === "failed") {
      await withDemoPolicyTransaction(async ({ db: tx, ...demoContext }) => {
        const locked = await lockMatchForUpdate(tx, id);
        if (!locked) throw new Error("NOT_FOUND");
        const match = await tx.match.findUnique({ where: { id }, include: { gameServer: true } });
        if (!match || !match.gameServer || match.gameServer.id !== serverId) throw new Error("NOT_FOUND");
        if (match.status === "FINISHED" || match.status === "CANCELLED") {
          if (match.gameServer) await markGameProcessStopped(tx, match.gameServer.id, id);
          return;
        }
        await refundAndCancel(tx, match, String(body.reason ?? "Match server failed/stopped before completion"), demoContext);
        if (match.gameServer) await markGameProcessStopped(tx, match.gameServer.id, id);
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "stopped") {
      await withDemoPolicyTransaction(async ({ db: tx, ...demoContext }) => {
        const locked = await lockMatchForUpdate(tx, id);
        if (!locked) throw new Error("NOT_FOUND");
        const match = await tx.match.findUnique({ where: { id }, include: { gameServer: true } });
        if (!match || !match.gameServer || match.gameServer.id !== serverId) throw new Error("NOT_FOUND");
        if (match.gameServer) await markGameProcessStopped(tx, match.gameServer.id, id);
        if (match && match.status === "LIVE") await refundAndCancel(tx, match, undefined, demoContext);
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND" || code === "SERVER_NOT_ASSIGNED") return NextResponse.json({ error: "Match/server not found" }, { status: 404 });
    if (code === "INVALID_STATUS") return NextResponse.json({ error: "Match is not ready" }, { status: 409 });
    if (code === "STALE_MATCH") return NextResponse.json({ error: "Match is no longer live" }, { status: 409 });
    if (code === "INVALID_PARTICIPANT") return NextResponse.json({ error: "Referee event participant is not in the match" }, { status: 409 });
    console.error(error);
    return NextResponse.json({ error: "Server state update failed" }, { status: 500 });
  }
}



