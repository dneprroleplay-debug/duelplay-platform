import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { leagueFromRating, leagueLabel, nextLeagueThreshold, pointsToNextLeague, leagueProgress } from "@/lib/leagues";

export async function GET() {
  try {
    const users = await prisma.user.findMany({
      where: { status: "ACTIVE", deletedAt: null, isTestAccount: false },
      select: { id: true, nickname: true, avatarUrl: true, playerStats: { select: { rating: true, winStreak: true } } },
      take: 5000,
    });
    const finishedMatches = await prisma.match.findMany({
      where: { status: "FINISHED", playerTwoId: { not: null }, winnerId: { not: null } },
      select: { winnerId: true, loserId: true },
    });
    const resultStats = new Map<string, { wins: number; losses: number }>();
    for (const match of finishedMatches) {
      if (match.winnerId) { const v=resultStats.get(match.winnerId) || {wins:0,losses:0}; v.wins += 1; resultStats.set(match.winnerId,v); }
      if (match.loserId) { const v=resultStats.get(match.loserId) || {wins:0,losses:0}; v.losses += 1; resultStats.set(match.loserId,v); }
    }
    const rows = users.map((u) => {
      const rating = u.playerStats?.rating ?? 0;
      const league = leagueFromRating(rating);
      const nextThreshold = nextLeagueThreshold(rating);
      return {
        id: u.id,
        nickname: u.nickname,
        avatarUrl: u.avatarUrl,
        rating,
        league,
        leagueLabel: leagueLabel(league),
        wins: resultStats.get(u.id)?.wins ?? 0,
        losses: resultStats.get(u.id)?.losses ?? 0,
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
