import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isServerManagerRequest } from "../auth";

export async function GET(request: NextRequest) {
  if (!isServerManagerRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const candidates = await prisma.match.findMany({
    where: { status: "READY", playerTwoId: { not: null }, gameServer: null },
    include: {
      playerOne: { select: { id: true, steamId: true, nickname: true } },
      playerTwo: { select: { id: true, steamId: true, nickname: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  const pending = candidates.find((match) => {
    const cfg = match.serverConfig;
    return Boolean(cfg && typeof cfg === "object" && !Array.isArray(cfg) && (cfg as Record<string, unknown>).managerRequested === true);
  });

  return NextResponse.json({
    pending: pending
      ? {
          id: pending.id,
          mapName: pending.mapName ?? "Dust2",
          playerOne: pending.playerOne,
          playerTwo: pending.playerTwo,
          betAmount: pending.betAmount.toString(),
        }
      : null,
  });
}
