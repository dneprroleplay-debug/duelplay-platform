import { NextRequest, NextResponse } from "next/server";
import { enforceIpRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-meta";
import { prisma } from "@/lib/prisma";
import { isServerManagerRequest } from "../auth";
import { runMatchWatchdog } from "@/lib/match-lifecycle";


export async function GET(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    await prisma.$transaction(tx => enforceIpRateLimit(tx, ip, "SERVER_MANAGER_QUEUE", 300, 10 * 60_000));
  } catch (error) {
    if (error instanceof Error && error.message === "RATE_LIMITED") return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    throw error;
  }

  if (!isServerManagerRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await runMatchWatchdog();

  const candidates = await prisma.match.findMany({
    where: {
      status: "STARTING",
      playerTwoId: { not: null },
      gameServer: null,
    },
    include: {
      playerOne: {
        select: {
          id: true,
          steamId: true,
          nickname: true,
        },
      },
      playerTwo: {
        select: {
          id: true,
          steamId: true,
          nickname: true,
        },
      },
    },
    orderBy: {
      createdAt: "asc",
    },
    take: 20,
  });

  const pending = candidates.find((match) => {
    const cfg = match.serverConfig;

    return Boolean(
      cfg &&
        typeof cfg === "object" &&
        !Array.isArray(cfg) &&
        (cfg as Record<string, unknown>).managerRequested === true,
    );
  });

  return NextResponse.json({
    pending: pending
      ? {
          id: pending.id,
          mapName: pending.mapName ?? "aim_redline",
          playerOne: pending.playerOne,
          playerTwo: pending.playerTwo,
          betAmount: pending.betAmount.toString(),
        }
      : null,
  });
}
