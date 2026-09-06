import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { leagueFromRating, leagueLabel, nextLeagueThreshold, pointsToNextLeague, leagueProgress } from "@/lib/leagues";

export async function GET() {
  try {
    const users = await prisma.user.findMany({
      where: { status: "ACTIVE", deletedAt: null, isTestAccount: false },
      select: { id: true, nickname: true, avatarUrl: true, playerStats: { select: { rating: true, wins: true, losses: true, winStreak: true } } },
      take: 5000,
    });
    const rows = users.map((u) => {
      const rating = u.playerStats?.rating ?? 1000;
      const league = leagueFromRating(rating);
      const nextThreshold = nextLeagueThreshold(rating);
      return {
        id: u.id,
        nickname: u.nickname,
        avatarUrl: u.avatarUrl,
        rating,
        league,
        leagueLabel: leagueLabel(league),
        wins: u.playerStats?.wins ?? 0,
        losses: u.playerStats?.losses ?? 0,
        streak: u.playerStats?.winStreak ?? 0,
        nextThreshold,
        pointsToNext: pointsToNextLeague(rating),
        progress: leagueProgress(rating),
      };
    });
    rows.sort((a, b) => b.rating - a.rating || b.wins - a.wins || a.losses - b.losses || a.nickname.localeCompare(b.nickname));
    return NextResponse.json(rows.map((x, i) => ({ ...x, position: i + 1 })));
  } catch (error) {
    console.error("leagues route failed", error);
    return NextResponse.json({ error: "Unable to load leagues" }, { status: 500 });
  }
}
