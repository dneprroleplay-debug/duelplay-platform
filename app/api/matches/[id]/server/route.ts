import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isServerManagerRequest } from "@/app/api/server-manager/auth";

function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

async function refundAndCancel(tx: Prisma.TransactionClient, match: Prisma.MatchGetPayload<{ include: { gameServer: true } }>) {
  const amount = Number(match.betAmount);
  for (const uid of [match.playerOneId, match.playerTwoId].filter(Boolean) as string[]) {
    const wallet = await tx.wallet.findUnique({ where: { userId: uid } });
    if (!wallet) continue;
    const before = Number(wallet.balance), after = Number((before + amount).toFixed(4));
    await tx.wallet.update({ where: { id: wallet.id }, data: { balance: after, lockedBalance: { decrement: amount } } });
    await tx.transaction.create({ data: { walletId: wallet.id, type: "REFUND", status: "COMPLETED", amount, balanceBefore: before, balanceAfter: after, referenceId: match.id, description: "Возврат ставки: сервер матча не запустился" } });
  }
  await tx.match.update({ where: { id: match.id }, data: { status: "CANCELLED", endedAt: new Date(), serverConfig: { ...asRecord(match.serverConfig), state: "FAILED", connectUrl: "" } } });
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
        const match = await tx.match.findUnique({ where: { id }, include: { gameServer: true } });
        if (!match || !match.gameServer || match.gameServer.id !== serverId) throw new Error("NOT_FOUND");
        if (match.status !== "READY") throw new Error("INVALID_STATUS");
        const port = Number(body.port ?? match.gameServer.port);
        const host = String(body.host ?? match.gameServer.host);
        await tx.gameServer.update({ where: { id: serverId }, data: { status: "BUSY", host, port, processId: Number.isInteger(body.processId) ? Number(body.processId) : null, startedAt: new Date(), lastHeartbeat: new Date() } });
        const cfg = asRecord(match.serverConfig);
        return tx.match.update({ where: { id }, data: { status: "LIVE", startedAt: new Date(), serverConfig: { ...cfg, state: "READY", serverId, connectUrl: `steam://connect/${host}:${port}` } } });
      });
      return NextResponse.json({ ok: true, match });
    }

    if (action === "heartbeat") {
      await prisma.gameServer.updateMany({ where: { id: serverId, matchId: id }, data: { lastHeartbeat: new Date(), status: "READY" } });
      return NextResponse.json({ ok: true });
    }

    if (action === "failed") {
      await prisma.$transaction(async tx => {
        const match = await tx.match.findUnique({ where: { id }, include: { gameServer: true } });
        if (!match) throw new Error("NOT_FOUND");
        if (match.status === "FINISHED" || match.status === "CANCELLED") {
          if (match.gameServer) await tx.gameServer.update({ where: { id: match.gameServer.id }, data: { status: "OFFLINE", matchId: null, processId: null, stoppedAt: new Date(), lastHeartbeat: null } });
          return;
        }
        await refundAndCancel(tx, match);
        if (match.gameServer) await tx.gameServer.update({ where: { id: match.gameServer.id }, data: { status: "ERROR", matchId: null, processId: null, stoppedAt: new Date(), lastHeartbeat: null } });
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "stopped") {
      await prisma.$transaction(async tx => {
        const match = await tx.match.findUnique({ where: { id }, include: { gameServer: true } });
        if (match?.gameServer) await tx.gameServer.update({ where: { id: match.gameServer.id }, data: { status: "OFFLINE", matchId: null, processId: null, stoppedAt: new Date(), lastHeartbeat: null } });
        if (match && match.status === "LIVE") await refundAndCancel(tx, match);
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return NextResponse.json({ error: "Match/server not found" }, { status: 404 });
    if (code === "INVALID_STATUS") return NextResponse.json({ error: "Match is not ready" }, { status: 409 });
    console.error(error);
    return NextResponse.json({ error: "Server state update failed" }, { status: 500 });
  }
}
