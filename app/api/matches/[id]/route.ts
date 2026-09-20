export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildLiveMatchState } from "@/lib/live-match";
import { cancelMatchWithRefund, resolveConnectionTimeout } from "@/lib/match-lifecycle";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let match = await prisma.match.findUnique({
    where: { id },
    include: {
      game: true,
      gameServer: { select: { lastHeartbeat: true, status: true } },
      playerOne: { select: { id: true, nickname: true, avatarUrl: true } },
      playerTwo: { select: { id: true, nickname: true, avatarUrl: true } },
      winner: { select: { id: true, nickname: true } },
      loser: { select: { id: true, nickname: true } },
    },
  });

  if (!match) return NextResponse.json({ error: "Матч не найден" }, { status: 404 });

  // The match page polls this endpoint every second. Resolve an expired
  // connection phase here so the technical-win/refund lifecycle does not
  // depend on the legacy presence endpoint or a separate watchdog tick.
  if (
    match.status === "LIVE" &&
    !match.connectionPhaseCompleted &&
    match.liveDeadlineAt &&
    match.liveDeadlineAt.getTime() <= Date.now()
  ) {
    const cfg =
      match.serverConfig &&
      typeof match.serverConfig === "object" &&
      !Array.isArray(match.serverConfig)
        ? (match.serverConfig as Record<string, unknown>)
        : {};

    const ids = Array.isArray(cfg.connectedSteamIds)
      ? [...new Set(cfg.connectedSteamIds.map(String).map((v) => v.trim()).filter(Boolean))]
      : [];

    try {
      if (ids.length === 1) {
        await resolveConnectionTimeout(id, ids[0]);
      } else if (ids.length === 0) {
        await cancelMatchWithRefund(id, "No player connected within 5 minutes");
      }
    } catch (error) {
      console.error(`[DuelPlay] connection-timeout lifecycle failed for ${id}`, error);
      // Do not turn an expired LIVE match into a broken match page. The manager
      // heartbeat/timeout path can retry the authoritative transition.
    }

    match = await prisma.match.findUnique({
      where: { id },
      include: {
        game: true,
        gameServer: { select: { lastHeartbeat: true, status: true } },
        playerOne: { select: { id: true, nickname: true, avatarUrl: true } },
        playerTwo: { select: { id: true, nickname: true, avatarUrl: true } },
        winner: { select: { id: true, nickname: true } },
        loser: { select: { id: true, nickname: true } },
      },
    });

    if (!match) return NextResponse.json({ error: "Матч не найден" }, { status: 404 });
  }

  const rawConfig = match.serverConfig;
  const liveState = ["READY", "STARTING", "LIVE"].includes(match.status)
    ? buildLiveMatchState(rawConfig, Date.now(), match.gameServer?.lastHeartbeat)
    : null;
  const safeConfig =
    rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig)
      ? Object.fromEntries(
          Object.entries(rawConfig as Record<string, unknown>).filter(
            ([key]) => !["connectedSteamIds", "playerOneSteamId", "playerTwoSteamId", "processId"].includes(key),
          ),
        )
      : rawConfig;

  return NextResponse.json(
    { match: { ...match, serverConfig: safeConfig, liveState } },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        "CDN-Cache-Control": "no-store",
        "Vercel-CDN-Cache-Control": "no-store",
      },
    },
  );
}
