import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildLiveMatchState } from "@/lib/live-match";
import { cancelMatchWithRefund, resolveConnectionTimeout } from "@/lib/match-lifecycle";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let match = await prisma.match.findUnique({
    where: { id },
    include: {
      playerOne: { select: { id: true, nickname: true, avatarUrl: true, steamAvatarUrl: true } },
      playerTwo: { select: { id: true, nickname: true, avatarUrl: true, steamAvatarUrl: true } },
      gameServer: { select: { lastHeartbeat: true, status: true, host: true, port: true } },
    },
  });
  if (!match) return NextResponse.json({ error: "Матч не найден" }, { status: 404 });

  // The browser countdown is only a display. The deadline itself is authoritative
  // on the server, so resolve an expired connection phase during the next poll.
  if (
    match.status === "LIVE" &&
    !match.connectionPhaseCompleted &&
    match.connectionDeadlineAt &&
    match.connectionDeadlineAt.getTime() <= Date.now()
  ) {
    const cfg = match.serverConfig && typeof match.serverConfig === "object" && !Array.isArray(match.serverConfig)
      ? match.serverConfig as Record<string, unknown>
      : {};
    const ids = Array.isArray(cfg.connectedSteamIds)
      ? [...new Set(cfg.connectedSteamIds.map(String).map(v => v.trim()).filter(Boolean))]
      : [];

    if (ids.length === 1) {
      await resolveConnectionTimeout(id, ids[0]);
    } else if (ids.length === 0) {
      await cancelMatchWithRefund(id, "No player connected within 10 minutes");
    }

    match = await prisma.match.findUnique({
      where: { id },
      include: {
        playerOne: { select: { id: true, nickname: true, avatarUrl: true, steamAvatarUrl: true } },
        playerTwo: { select: { id: true, nickname: true, avatarUrl: true, steamAvatarUrl: true } },
        gameServer: { select: { lastHeartbeat: true, status: true, host: true, port: true } },
      },
    });
    if (!match) return NextResponse.json({ error: "Матч не найден" }, { status: 404 });
  }

  const liveState = ["READY", "STARTING", "LIVE"].includes(match.status)
    ? buildLiveMatchState(match.serverConfig, Date.now(), match.gameServer?.lastHeartbeat)
    : null;
  const cfg = match.serverConfig && typeof match.serverConfig === "object" && !Array.isArray(match.serverConfig)
    ? match.serverConfig as Record<string, unknown>
    : {};

  return NextResponse.json(
    {
      ok: true,
      status: match.status,
      playerOne: match.playerOne,
      playerTwo: match.playerTwo,
      connectionDeadlineAt: match.connectionDeadlineAt,
      liveState,
      serverConfig: {
        state: typeof cfg.state === "string" ? cfg.state : null,
        connectUrl: typeof cfg.connectUrl === "string" ? cfg.connectUrl : null,
        managerRequested: cfg.managerRequested === true,
        connectionPhaseCompleted: cfg.connectionPhaseCompleted === true,
      },
    },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate", "CDN-Cache-Control": "no-store", "Vercel-CDN-Cache-Control": "no-store", "Vary": "Cookie" } },
  );
}
