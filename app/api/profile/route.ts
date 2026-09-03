import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Войдите в аккаунт" }, { status: 401 });
  const [matches, wins, losses, active, referralCount, referralTransactions] = await Promise.all([
    prisma.match.findMany({ where: { OR: [{ playerOneId: user.id }, { playerTwoId: user.id }] }, include: { game: true, playerOne: { select: { nickname: true } }, playerTwo: { select: { nickname: true } }, winner: { select: { nickname: true } } }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.match.count({ where: { winnerId: user.id, status: "FINISHED" } }),
    prisma.match.count({ where: { loserId: user.id, status: "FINISHED" } }),
    prisma.match.count({ where: { OR: [{ playerOneId: user.id }, { playerTwoId: user.id }], status: { in: ["WAITING_FOR_PLAYERS", "READY", "LIVE"] } } }),
    prisma.user.count({ where: { referredById: user.id, deletedAt: null } }),
    prisma.transaction.findMany({ where: { wallet: { userId: user.id }, type: "REFERRAL", status: "COMPLETED" }, select: { amount: true } }),
  ]);
  const referralEarned = referralTransactions.reduce((sum, tx) => sum + Number(tx.amount), 0);
  return NextResponse.json({ user: { id: user.id, nickname: user.nickname, steamId: user.steamId, email: user.email, avatarUrl: user.avatarUrl, steamAvatarUrl: user.steamAvatarUrl, themePreference: user.themePreference, level: user.level, xp: user.xp, reputation: user.reputation, trustScore: user.trustScore.toString(), referralCode: user.referralCode, balance: user.wallet?.balance.toString() ?? "0", lockedBalance: user.wallet?.lockedBalance.toString() ?? "0" }, stats: { matches: wins + losses, wins, losses, active, winRate: wins + losses ? Math.round(wins / (wins + losses) * 100) : 0, referralCount, referralEarned }, matches });
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Войдите в аккаунт" }, { status: 401 });
  let body: { avatarUrl?: unknown; themePreference?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 }); }
  if (typeof body.themePreference === "string") {
    const value = body.themePreference;
    const allowed = ["STANDARD","BLACK_BLUE","FULL_GREEN","FULL_PINK","NEON","CYBER_PURPLE","CRIMSON","ORANGE","CYAN","GOLD"];
    if (!allowed.includes(value)) return NextResponse.json({ error: "Неизвестная тема" }, { status: 400 });
    const updated = await prisma.user.update({ where: { id: user.id }, data: { themePreference:value }, select: { themePreference:true } });
    return NextResponse.json({ user: updated });
  }
  const avatarUrl = body.avatarUrl;
  if (avatarUrl === null) {
    const updated = await prisma.user.update({ where: { id: user.id }, data: { avatarUrl: user.steamAvatarUrl }, select: { avatarUrl: true, steamAvatarUrl: true } });
    return NextResponse.json({ user: updated });
  }
  if (typeof avatarUrl !== "string" || avatarUrl.length < 1 || avatarUrl.length > 700_000) return NextResponse.json({ error: "Некорректное изображение" }, { status: 400 });
  const allowedPreset = avatarUrl.startsWith("/avatars/") && /\.(svg|jpg|jpeg|png|webp)$/i.test(avatarUrl);
  const allowedUpload = /^data:image\/(jpeg|png|webp);base64,/i.test(avatarUrl);
  if (!allowedPreset && !allowedUpload) return NextResponse.json({ error: "Недопустимый формат аватара" }, { status: 400 });
  const updated = await prisma.user.update({ where: { id: user.id }, data: { avatarUrl }, select: { avatarUrl: true, steamAvatarUrl: true } });
  return NextResponse.json({ user: updated });
}
