import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const [stats, rows] = await Promise.all([
      prisma.playerStats.findUnique({ where: { userId: me.id } }),
      prisma.matchPlayerStat.findMany({
        where: { userId: me.id, match: { status: "FINISHED" } },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          matchId: true,
          kills: true,
          assists: true,
          deaths: true,
          headshots: true,
          damage: true,
          score: true,
          weapon: true,
          mapName: true,
          createdAt: true,
          match: { select: { id: true, status: true, winnerId: true, createdAt: true, endedAt: true, mapName: true, playerOneId: true, playerTwoId: true } },
        },
      }),
    ]);

    const kills = stats?.kills ?? rows.reduce((n, x) => n + x.kills, 0);
    const deaths = stats?.deaths ?? rows.reduce((n, x) => n + x.deaths, 0);
    const headshots = stats?.headshots ?? rows.reduce((n, x) => n + x.headshots, 0);
    const damage = stats?.damage ?? rows.reduce((n, x) => n + x.damage, 0);
    const recordedMatches = rows.length;
    const mapCount = new Map<string, number>();
    const weaponCount = new Map<string, number>();
    for (const x of rows) {
      const map = x.mapName || x.match.mapName;
      if (map) mapCount.set(map, (mapCount.get(map) || 0) + 1);
      if (x.weapon) weaponCount.set(x.weapon, (weaponCount.get(x.weapon) || 0) + 1);
    }

    return NextResponse.json({
      rating: stats?.rating ?? 1000,
      wins: stats?.wins ?? 0,
      losses: stats?.losses ?? 0,
      totalDuels: stats?.totalDuels ?? 0,
      streak: stats?.winStreak ?? 0,
      bestStreak: stats?.bestStreak ?? 0,
      kills,
      deaths,
      headshots,
      totalDamage: damage,
      kd: deaths ? Number((kills / deaths).toFixed(2)) : kills,
      hsPercent: kills ? Number((headshots / kills * 100).toFixed(1)) : 0,
      averageDamage: recordedMatches ? Number((damage / recordedMatches).toFixed(1)) : 0,
      recordedMatches,
      favouriteWeapon: [...weaponCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "—",
      bestMap: [...mapCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "—",
      ratingHistory: Array.isArray(stats?.ratingHistory) ? stats.ratingHistory : [],
      history: rows.map((x) => ({
        matchId: x.matchId,
        mapName: x.mapName || x.match.mapName,
        weapon: x.weapon,
        kills: x.kills,
        assists: x.assists,
        deaths: x.deaths,
        headshots: x.headshots,
        damage: x.damage,
        score: x.score,
        result: x.match.winnerId === me.id ? "WIN" : "LOSS",
        createdAt: x.match.createdAt,
        endedAt: x.match.endedAt,
      })),
    });
  } catch (error) {
    console.error("analytics route failed", error);
    return NextResponse.json({ error: "Unable to load analytics" }, { status: 500 });
  }
}
