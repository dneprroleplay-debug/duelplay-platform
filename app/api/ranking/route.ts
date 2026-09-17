import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const users = await prisma.user.findMany({
      where: { status: "ACTIVE", deletedAt: null, isTestAccount: false },
      select: { nickname: true, level: true, xp: true, avatarUrl: true, playerStats: { select: { rating: true } } },
      take: 50,
    });
    const rows = users.map((u) => ({
      nickname: u.nickname,
      level: Number(u.level),
      xp: Number(u.xp),
      avatarUrl: u.avatarUrl,
      rating: Number(u.playerStats?.rating ?? 0),
    }));
    rows.sort((a, b) => b.rating - a.rating || b.xp - a.xp || a.nickname.localeCompare(b.nickname));
    return NextResponse.json(rows);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Не удалось загрузить рейтинг" }, { status: 500 });
  }
}
