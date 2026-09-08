import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { isServerManagerRequest } from "@/app/api/server-manager/auth";
import { creditWallet } from "@/lib/wallet";
import { lockMatchForUpdate } from "@/lib/match-lifecycle";
import { deadlineFromNow, MATCH_CONNECTION_TIMEOUT_MS } from "@/lib/match-timers";

function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

async function refundAndCancel(tx: Prisma.TransactionClient, match: Prisma.MatchGetPayload<{ include: { gameServer: true } }>, reason = "Match server failed/stopped before completion") {
  const amount = Number(match.betAmount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("INVALID_AMOUNT");

  for (const uid of [match.playerOneId, match.playerTwoId].filter(Boolean) as string[]) {
    const idem = `refund:${match.id}:${uid}`;
    const existing = await tx.transaction.findUnique({ where: { idempotencyKey: idem } });

    const rows = await tx.$queryRaw<Array<{ id: string; lockedBalance: Prisma.Decimal }>>`
      SELECT id, "lockedBalance" FROM "Wallet" WHERE "userId" = ${uid}::uuid FOR UPDATE
    `;
    const wallet = rows[0];
    if (!wallet) throw new Error("WALLET");

    if (!existing) {
      if (Number(wallet.lockedBalance) < amount) throw new Error("LOCKED_STAKE");

      await creditWallet(
      tx,
      uid,
      amount,
      idem,
      "REFUND",
      reason,
      match.id,
    );
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { lockedBalance: { decrement: amount } },
      });
    }

    await tx.notification.create({
      data: {
        userId: uid,
        type: "CANCELLATION",
        title: "Match cancelled",
        body: reason.toLowerCase().includes("nobody connected") || reason.toLowerCase().includes("no player connected")
          ? "The match was automatically cancelled because nobody connected to the CS2 server in time. Your stake was refunded."
          : "The match was automatically cancelled because the CS2 server could not continue. Your stake was refunded.",
        payload: { matchId: match.id, reason },
      },
    });
  }

  await tx.match.update({
    where: { id: match.id },
    data: {
      status: "CANCELLED",
      endedAt: new Date(),
      serverConfig: { ...asRecord(match.serverConfig), state: "FAILED", connectUrl: "" },
    },
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isServerManagerRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await request.json();
  const action = String(body.action ?? "");
  const serverId = String(body.serverId ?? "");
  try {
    if (action === "ready") {
      const match = await prisma.$transaction(async tx => {
        const locked = await lockMatchForUpdate(tx, id);
        if (!locked) throw new Error("NOT_FOUND");
        const match = await tx.match.findUnique({ where: { id }, include: { gameServer: true } });
        if (!match || !match.gameServer || match.gameServer.id !== serverId) throw new Error("NOT_FOUND");
        if (!["READY","STARTING"].includes(match.status)) throw new Error("INVALID_STATUS");
        const port = Number(body.port ?? match.gameServer.port);
        const host = String(body.host ?? match.gameServer.host);
        await tx.gameServer.update({ where: { id: serverId }, data: { status: "BUSY", host, port, processId: Number.isInteger(body.processId) ? Number(body.processId) : null, startedAt: new Date(), lastHeartbeat: new Date() } });
        const cfg = asRecord(match.serverConfig);
        return tx.match.update({ where: { id }, data: { status: "LIVE", startedAt: new Date(), startDeadlineAt: null, connectionDeadlineAt: deadlineFromNow(MATCH_CONNECTION_TIMEOUT_MS),
        connectionPhaseCompleted: false,
        serverConfig: { ...cfg, state: "READY", serverId, connectUrl: `steam://connect/${host}:${port}` } } });
      });
      return NextResponse.json({ ok: true, match });
    }

    if (action === "heartbeat") {
      const connectedSteamIds = Array.isArray(body.connectedSteamIds)
        ? body.connectedSteamIds
            .map((value: unknown) => String(value).trim())
            .filter(Boolean)
        : [];

      const connectionPhaseCompleted =
        body.connectionPhaseCompleted === true;

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

        const cfg = asRecord(match.serverConfig);
        const participantSteamIds = new Set(
          [match.playerOne?.steamId, match.playerTwo?.steamId]
            .map(value => String(value ?? '').trim())
            .filter(Boolean),
        );
        const normalizedConnectedSteamIds: string[] = connectedSteamIds;
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
            connectionDeadlineAt: phaseDone ? null : undefined,
            serverConfig: {
              ...cfg,
              connectedSteamIds: validConnectedSteamIds,
              connectionPhaseCompleted: phaseDone,
            },
          },
        });
      });

      return NextResponse.json({ ok: true });
    }

    if (action === "failed") {
      await prisma.$transaction(async tx => {
        const locked = await lockMatchForUpdate(tx, id);
        if (!locked) throw new Error("NOT_FOUND");
        const match = await tx.match.findUnique({ where: { id }, include: { gameServer: true } });
        if (!match || !match.gameServer || match.gameServer.id !== serverId) throw new Error("NOT_FOUND");
        if (match.status === "FINISHED" || match.status === "CANCELLED") {
          if (match.gameServer) await tx.gameServer.update({ where: { id: match.gameServer.id }, data: { status: "OFFLINE", matchId: null, processId: null, stoppedAt: new Date(), lastHeartbeat: null } });
          return;
        }
        await refundAndCancel(tx, match, String(body.reason ?? "Match server failed/stopped before completion"));
        if (match.gameServer) await tx.gameServer.update({ where: { id: match.gameServer.id }, data: { status: "OFFLINE", matchId: null, processId: null, stoppedAt: new Date(), lastHeartbeat: null } });
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "stopped") {
      await prisma.$transaction(async tx => {
        const locked = await lockMatchForUpdate(tx, id);
        if (!locked) throw new Error("NOT_FOUND");
        const match = await tx.match.findUnique({ where: { id }, include: { gameServer: true } });
        if (!match || !match.gameServer || match.gameServer.id !== serverId) throw new Error("NOT_FOUND");
        if (match.gameServer) await tx.gameServer.update({ where: { id: match.gameServer.id }, data: { status: "OFFLINE", matchId: null, processId: null, stoppedAt: new Date(), lastHeartbeat: null } });
        if (match && match.status === "LIVE") await refundAndCancel(tx, match);
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND" || code === "SERVER_NOT_ASSIGNED") return NextResponse.json({ error: "Match/server not found" }, { status: 404 });
    if (code === "INVALID_STATUS") return NextResponse.json({ error: "Match is not ready" }, { status: 409 });
    if (code === "STALE_MATCH") return NextResponse.json({ error: "Match is no longer live" }, { status: 409 });
    console.error(error);
    return NextResponse.json({ error: "Server state update failed" }, { status: 500 });
  }
}



