import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { leagueFromRating } from "@/lib/leagues";

const PERIODS = ["global", "daily", "weekly", "seasonal"] as const;
type Period = (typeof PERIODS)[number];

export async function GET(request: NextRequest) {
  try {
    const periodValue = (request.nextUrl.searchParams.get("period") || "global") as Period;
    if (!PERIODS.includes(periodValue)) return NextResponse.json({ error: "Invalid leaderboard period" }, { status: 400 });

    const requestedLimit = Number(request.nextUrl.searchParams.get("limit") || 100);
    const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, Math.floor(requestedLimit))) : 100;
    const now = new Date();
    let since: Date | undefined;
    let season: { id: string; name: string; startsAt: Date; endsAt: Date } | null = null;

    if (periodValue === "daily") since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    if (periodValue === "weekly") since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    if (periodValue === "seasonal") {
      season = await prisma.season.findFirst({ where: { active: true }, orderBy: { startsAt: "desc" }, select: { id: true, name: true, startsAt: true, endsAt: true } });
      if (!season) return NextResponse.json({ period: periodValue, season: null, rows: [] });
      since = season.startsAt;
    }

    const users = await prisma.user.findMany({
      where: { status: "ACTIVE", deletedAt: null, isTestAccount: false },
      select: { id: true, nickname: true, avatarUrl: true, level: true, xp: true, playerStats: { select: { rating: true, wins: true, losses: true } } },
      take: 5000,
    });

    const base = users.map((u) => ({
      id: u.id,
      nickname: u.nickname,
      avatarUrl: u.avatarUrl,
      level: u.level,
      xp: u.xp,
      rating: u.playerStats?.rating ?? 0,
      wins: 0,
      losses: 0,
      played: 0,
    }));

    let rows = base;
    if (since) {
      const matches = await prisma.match.findMany({
        where: { createdAt: { gte: since }, status: "FINISHED", playerTwoId: { not: null }, winnerId: { not: null } },
        select: { winnerId: true, loserId: true, playerOneId: true, playerTwoId: true },
      });
      const matchStats = new Map<string, { wins: number; losses: number; played: number }>();
      for (const match of matches) {
        const ids = [match.playerOneId, match.playerTwoId].filter(Boolean) as string[];
        for (const id of ids) {
          const value = matchStats.get(id) || { wins: 0, losses: 0, played: 0 };
          if (match.winnerId === id) value.wins += 1;
          else if (match.loserId === id) value.losses += 1;
          else continue;
          value.played += 1;
          matchStats.set(id, value);
        }
      }
      rows = base.filter((x) => (matchStats.get(x.id)?.played ?? 0) > 0).map((x) => ({ ...x, ...(matchStats.get(x.id) as { wins: number; losses: number; played: number }) }));
    } else {
      const matches = await prisma.match.findMany({
        where: { status: "FINISHED", playerTwoId: { not: null }, winnerId: { not: null } },
        select: { winnerId: true, loserId: true },
      });
      const matchStats = new Map<string, { wins: number; losses: number; played: number }>();
      for (const match of matches) {
        for (const [id, isWin] of [[match.winnerId, true], [match.loserId, false]] as const) {
          if (!id) continue;
          const value = matchStats.get(id) || { wins: 0, losses: 0, played: 0 };
          value.played += 1;
          if (isWin) value.wins += 1;
          else value.losses += 1;
          matchStats.set(id, value);
        }
      }
      rows = base.map((x) => ({ ...x, ...(matchStats.get(x.id) || { wins: 0, losses: 0, played: 0 }) }));
    }

    rows.sort((a, b) => {
      if (periodValue === "global") return b.rating - a.rating || b.wins - a.wins || a.losses - b.losses || a.nickname.localeCompare(b.nickname);
      return b.wins - a.wins || a.losses - b.losses || b.rating - a.rating || a.nickname.localeCompare(b.nickname);
    });

    return NextResponse.json({
      period: periodValue,
      season,
      rows: rows.slice(0, limit).map((x, i) => ({ ...x, position: i + 1, league: leagueFromRating(x.rating) })),
    });
  } catch (error) {
    console.error("leaderboards route failed", error);
    return NextResponse.json({ error: "Unable to load leaderboard" }, { status: 500 });
  }
}
