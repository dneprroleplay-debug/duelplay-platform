import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { Prisma } from "@prisma/client";

const HISTORY_STATUS_FILTERS: Record<string, Prisma.MatchWhereInput["status"]> = {
  all: { in: ["FINISHED", "CANCELLED", "DISPUTED"] },
  finished: "FINISHED",
  cancelled: "CANCELLED",
  disputed: "DISPUTED",
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ nickname: string }> }) {
  try {
    const { nickname } = await params;
    const viewer = await getCurrentUser();
    const profile = await prisma.user.findUnique({
      where: { nickname },
      select: { id: true, profileVisibility: true, showStatsPublic: true },
    });
    if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

    const isMe = Boolean(viewer && viewer.id === profile.id);
    let friendAccepted = false;
    if (viewer && !isMe) {
      const relation = await prisma.friend.findFirst({
        where: {
          status: "ACCEPTED",
          OR: [
            { senderId: viewer.id, receiverId: profile.id },
            { senderId: profile.id, receiverId: viewer.id },
          ],
        },
        select: { id: true },
      });
      friendAccepted = Boolean(relation);
    }

    const visibleToViewer = profile.profileVisibility === "PUBLIC" || isMe || (profile.profileVisibility === "FRIENDS" && friendAccepted);
    if (!visibleToViewer) {
      return NextResponse.json({ matches: [], nextCursor: null, hasMore: false, restricted: true, reason: profile.profileVisibility });
    }
    if (!isMe && !profile.showStatsPublic) {
      return NextResponse.json({ matches: [], nextCursor: null, hasMore: false, hidden: true });
    }

    const status = (request.nextUrl.searchParams.get("status") || "all").toLowerCase();
    const historyFilter = HISTORY_STATUS_FILTERS[status] || HISTORY_STATUS_FILTERS.all;
    const economyParam = request.nextUrl.searchParams.get("economyMode") ?? "ALL";
    if (economyParam !== "REAL" && economyParam !== "DEMO" && economyParam !== "ALL") {
      return NextResponse.json({ error: "Invalid economy mode", errorCode: "INVALID_ECONOMY_MODE" }, { status: 400 });
    }
    const economyFilter: Prisma.MatchWhereInput = economyParam === "ALL" ? {} : { economyMode: economyParam };
    const limitParam = Number(request.nextUrl.searchParams.get("limit"));
    const limit = Number.isInteger(limitParam) && limitParam > 0 ? Math.min(limitParam, 50) : 20;
    const cursorId = request.nextUrl.searchParams.get("cursor");
    let cursorCreatedAt: Date | undefined;
    if (cursorId) {
      const cursor = await prisma.match.findFirst({
        where: { id: cursorId, OR: [{ playerOneId: profile.id }, { playerTwoId: profile.id }] },
        select: { createdAt: true },
      });
      if (!cursor) return NextResponse.json({ error: "Invalid history cursor", errorCode: "INVALID_CURSOR" }, { status: 400 });
      cursorCreatedAt = cursor.createdAt;
    }

    const rows = await prisma.match.findMany({
      where: {
        ...economyFilter,
        OR: [{ playerOneId: profile.id }, { playerTwoId: profile.id }],
        status: historyFilter,
        ...(cursorCreatedAt ? { createdAt: { lt: cursorCreatedAt } } : {}),
      },
      include: {
        playerOne: { select: { id: true, nickname: true, avatarUrl: true } },
        playerTwo: { select: { id: true, nickname: true, avatarUrl: true } },
        game: { select: { title: true, slug: true } },
        winner: { select: { id: true, nickname: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const matches = hasMore ? rows.slice(0, limit) : rows;
    return NextResponse.json({
      matches,
      nextCursor: hasMore ? matches[matches.length - 1]?.id ?? null : null,
      hasMore,
      userId: profile.id,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Unable to load match history" }, { status: 500 });
  }
}
