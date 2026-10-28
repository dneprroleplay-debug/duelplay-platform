import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cosmeticFrameImageUrl } from "@/lib/cosmetic-frame-image";

export async function GET() {
  try {
    const users = await prisma.user.findMany({
      where: { status: "ACTIVE", deletedAt: null, isTestAccount: false },
      select: { nickname: true, level: true, xp: true, avatarUrl: true, equippedFrameItem: { select: { slug: true, name: true, imageUrl: true } }, playerStats: { select: { rating: true } } },
      take: 50,
    });
    const rows = users.map((u) => ({
      nickname: u.nickname,
      level: Number(u.level),
      xp: Number(u.xp),
      avatarUrl: u.avatarUrl,
      equippedFrame: u.equippedFrameItem ? { ...u.equippedFrameItem, imageUrl: cosmeticFrameImageUrl(u.equippedFrameItem.slug, u.equippedFrameItem.imageUrl) } : null,
      rating: Number(u.playerStats?.rating ?? 0),
    }));
    rows.sort((a, b) => b.rating - a.rating || b.xp - a.xp || a.nickname.localeCompare(b.nickname));
    return NextResponse.json(rows);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Не удалось загрузить рейтинг" }, { status: 500 });
  }
}
