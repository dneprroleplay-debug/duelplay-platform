import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isServerManagerRequest } from "../auth";

export async function POST(request: NextRequest) {
  if (!isServerManagerRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json();
  const matchId = String(body.matchId ?? "");
  const serverName = String(body.serverName ?? process.env.DUELPLAY_SERVER_ID ?? "cs2-1");
  const host = String(body.host ?? process.env.CS2_PUBLIC_HOST ?? "127.0.0.1");
  const port = Number(body.port ?? process.env.CS2_PORT ?? 27015);
  if (!matchId || !Number.isInteger(port) || port < 1 || port > 65535) return NextResponse.json({ error: "Invalid match or port" }, { status: 400 });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const match = await tx.match.findUnique({
        where: { id: matchId },
        include: { playerOne: { select: { steamId: true, isTestAccount: true } }, playerTwo: { select: { steamId: true, isTestAccount: true } }, gameServer: true },
      });
      if (!match) throw new Error("NOT_FOUND");
      if (match.status !== "READY" || !match.playerTwoId || !match.playerTwo) throw new Error("NOT_READY");
      const cfg = match.serverConfig && typeof match.serverConfig === "object" && !Array.isArray(match.serverConfig) ? match.serverConfig as Record<string, unknown> : {};
      if (cfg.managerRequested !== true) throw new Error("NOT_REQUESTED");
      const bothTestAccounts = match.playerOne.isTestAccount === true && match.playerTwo?.isTestAccount === true;
      if ((!match.playerOne.steamId || !match.playerTwo?.steamId) && !bothTestAccounts) throw new Error("STEAM_REQUIRED");
      if (match.gameServer) throw new Error("ALREADY_CLAIMED");

      const existing = await tx.gameServer.findUnique({ where: { name: serverName } });
      if (existing && existing.matchId) throw new Error("SERVER_BUSY");

      const server = existing
        ? await tx.gameServer.update({ where: { id: existing.id }, data: { host, port, status: "STARTING", matchId, processId: null, startedAt: null, stoppedAt: null, lastHeartbeat: new Date() } })
        : await tx.gameServer.create({ data: { name: serverName, host, port, status: "STARTING", matchId, lastHeartbeat: new Date() } });

      const current = (match.serverConfig ?? {}) as Record<string, unknown>;
      await tx.match.update({ where: { id: matchId }, data: { serverConfig: { ...current, state: "STARTING", serverId: server.id, connectUrl: `steam://connect/${host}:${port}` } } });
      return { serverId: server.id, matchId, host, port, playerOneSteamId: match.playerOne.steamId, playerTwoSteamId: match.playerTwo.steamId, mapName: match.mapName ?? "Dust2" };
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return NextResponse.json({ error: "Match not found" }, { status: 404 });
    if (code === "NOT_READY") return NextResponse.json({ error: "Match is not ready" }, { status: 409 });
    if (code === "NOT_REQUESTED") return NextResponse.json({ error: "Match has not requested a server" }, { status: 409 });
    if (code === "STEAM_REQUIRED") return NextResponse.json({ error: "Both players must have Steam linked before a server can start" }, { status: 409 });
    if (code === "ALREADY_CLAIMED" || code === "SERVER_BUSY") return NextResponse.json({ error: "Server is already busy" }, { status: 409 });
    console.error(error);
    return NextResponse.json({ error: "Could not claim server" }, { status: 500 });
  }
}

