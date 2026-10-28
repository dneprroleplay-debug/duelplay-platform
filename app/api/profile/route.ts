import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { calculateProfileCompletion, PROFILE_COMPLETION_REWARD_KEY } from "@/lib/profile-completion";
import { enforceRateLimit } from "@/lib/rate-limit";
import { syncLoginRewardFrameCatalog } from "@/lib/login-reward-frames";
import { cosmeticFrameImageUrl } from "@/lib/cosmetic-frame-image";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Войдите в аккаунт" }, { status: 401 });
  // Keep already equipped login-reward frames visually correct on profile load,
  // including items created before their image/metadata was added.
  await prisma.$transaction(async (tx) => { await syncLoginRewardFrameCatalog(tx); });
  const [matches, wins, losses, active, activeDemo, referralCount, referralTransactions, achievements, acceptedFriends, finishedMatches, demoFinishedMatches] = await Promise.all([
    prisma.match.findMany({ where: { OR: [{ playerOneId: user.id }, { playerTwoId: user.id }] }, include: { game: true, playerOne: { select: { nickname: true } }, playerTwo: { select: { nickname: true } }, winner: { select: { nickname: true } } }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.match.count({ where: { economyMode: "REAL", winnerId: user.id, status: "FINISHED" } }),
    prisma.match.count({ where: { economyMode: "REAL", loserId: user.id, status: "FINISHED" } }),
    prisma.match.count({ where: { economyMode: "REAL", OR: [{ playerOneId: user.id }, { playerTwoId: user.id }], status: { in: ["WAITING_FOR_PLAYERS", "READY", "LIVE"] } } }),
    prisma.match.count({ where: { economyMode: "DEMO", OR: [{ playerOneId: user.id }, { playerTwoId: user.id }], status: { in: ["WAITING_FOR_PLAYERS", "READY", "LIVE"] } } }),
    prisma.user.count({ where: { referredById: user.id, deletedAt: null } }),
    prisma.transaction.findMany({ where: { wallet: { userId: user.id }, type: "REFERRAL", status: "COMPLETED" }, select: { amount: true } }),
    prisma.userAchievement.findMany({where:{userId:user.id},include:{achievement:true},orderBy:{unlockedAt:"desc"}}),
    prisma.friend.count({where:{OR:[{senderId:user.id,status:"ACCEPTED"},{receiverId:user.id,status:"ACCEPTED"}]}}),
    prisma.match.count({where:{economyMode:"REAL",OR:[{playerOneId:user.id},{playerTwoId:user.id}],status:"FINISHED",winnerId:{not:null}}}),
    prisma.match.count({where:{economyMode:"DEMO",OR:[{playerOneId:user.id},{playerTwoId:user.id}],status:"FINISHED"}}),
  ]);
  const referralEarned = referralTransactions.reduce((sum, tx) => sum + Number(tx.amount), 0);
  const equippedFrameRow = user.equippedFrameItemId ? await prisma.cosmeticItem.findUnique({ where: { id: user.equippedFrameItemId }, select: { id: true, slug: true, name: true, imageUrl: true } }) : null;
  const equippedFrame = equippedFrameRow ? { ...equippedFrameRow, imageUrl: cosmeticFrameImageUrl(equippedFrameRow.slug, equippedFrameRow.imageUrl) } : null;
  const [equippedBanner, equippedTitle] = await Promise.all([
    user.equippedBannerItemId ? prisma.cosmeticItem.findFirst({ where: { id: user.equippedBannerItemId, type: "BANNER" }, select: { id: true, slug: true, name: true, imageUrl: true } }) : null,
    user.equippedTitleItemId ? prisma.cosmeticItem.findFirst({ where: { id: user.equippedTitleItemId, type: "TITLE" }, select: { id: true, slug: true, name: true, imageUrl: true } }) : null,
  ]);
  const completion = calculateProfileCompletion({ hasCustomAvatar: Boolean(user.avatarUrl), acceptedFriends, finishedMatches, achievements: achievements.length, hasBothBindings: Boolean(user.steamId && user.email && user.emailVerifiedAt) });
  if (completion.rewardUnlocked) {
    await prisma.rewardGrant.upsert({
      where: { idempotencyKey: `${PROFILE_COMPLETION_REWARD_KEY}:${user.id}` },
      create: { userId: user.id, idempotencyKey: `${PROFILE_COMPLETION_REWARD_KEY}:${user.id}`, description: "Profile completion avatar and frame", referenceId: "/avatars/rewards/profile-complete.svg" },
      update: {},
    });
    // Grant the profile-completion frame through the existing cosmetic inventory.
    // Unique ownership and idempotent upsert prevent duplicate items on refresh.
    const frame = await prisma.cosmeticItem.findUnique({ where: { slug: "frame-profile-complete" }, select: { id: true } });
    if (frame) await prisma.cosmeticPurchase.upsert({
      where: { userId_itemId: { userId: user.id, itemId: frame.id } },
      create: { userId: user.id, itemId: frame.id, price: 0 },
      update: {},
    });
  }
  return NextResponse.json({ referralLink: `${process.env.NEXT_PUBLIC_APP_URL || ""}/login?ref=${encodeURIComponent(user.referralCode)}`, user: { id: user.id, nickname: user.nickname, steamId: user.steamId, email: user.email, emailVerifiedAt: user.emailVerifiedAt, avatarUrl: user.avatarUrl, steamAvatarUrl: user.steamAvatarUrl, themePreference: user.themePreference, profileVisibility: user.profileVisibility, showStatsPublic: user.showStatsPublic, allowChallenges: user.allowChallenges, allowMessages: user.allowMessages, level: user.level, xp: user.xp, reputation: user.reputation, trustScore: user.trustScore.toString(), referralCode: user.referralCode, balance: user.wallet?.balance.toString() ?? "0", lockedBalance: user.wallet?.lockedBalance.toString() ?? "0" }, stats: { matches: wins + losses, wins, losses, active, activeReal: active, activeDemo, demoFinishedMatches, winRate: wins + losses ? Math.round(wins / (wins + losses) * 100) : 0, referralCount, referralEarned }, equippedFrame, equippedBanner: equippedBanner ? { ...equippedBanner, imageUrl: equippedBanner.imageUrl || (equippedBanner.slug === "pink-banner" ? "/images/banners/pink-arena-banner.svg" : null) } : null, equippedTitle, profileCompletion: completion.percent, profileCompletionProgress: { completed: completion.completed, total: completion.total, rewardUnlocked: completion.rewardUnlocked, items: completion.items, friends: acceptedFriends, finishedMatches, achievements: achievements.length, hasCustomAvatar: Boolean(user.avatarUrl) }, achievements:achievements.map(x=>x.achievement), matches });
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Войдите в аккаунт" }, { status: 401 });
  try {
    await prisma.$transaction(tx => enforceRateLimit(tx, user.id, "PROFILE_PATCH", 30, 10 * 60_000));
  } catch (error) {
    if (error instanceof Error && error.message === "RATE_LIMITED") return NextResponse.json({ error: "Слишком много изменений профиля. Попробуйте позже." }, { status: 429 });
    throw error;
  }
  let body: { nickname?: unknown; avatarUrl?: unknown; themePreference?: unknown; profileVisibility?: unknown; showStatsPublic?: unknown; allowChallenges?: unknown; allowMessages?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 }); }
  if (typeof body.nickname === "string") {
    const nickname = body.nickname.trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(nickname)) return NextResponse.json({ error: "Никнейм: 3–20 символов, только латиница, цифры и _" }, { status: 400 });
    const existing = await prisma.user.findFirst({ where: { nickname, NOT: { id: user.id } }, select: { id: true } });
    if (existing) return NextResponse.json({ error: "Этот никнейм уже занят" }, { status: 409 });
    const updated = await prisma.user.update({ where: { id: user.id }, data: { nickname }, select: { nickname: true } });
    return NextResponse.json({ user: updated });
  }
  if (typeof body.profileVisibility === "string" || typeof body.showStatsPublic === "boolean" || typeof body.allowChallenges === "boolean" || typeof body.allowMessages === "boolean") {
    const visibility = typeof body.profileVisibility === "string" ? body.profileVisibility : undefined;
    if (visibility !== undefined && !["PUBLIC", "FRIENDS", "PRIVATE"].includes(visibility)) return NextResponse.json({ error: "Неизвестная видимость профиля" }, { status: 400 });
    const updated = await prisma.user.update({ where: { id: user.id }, data: { ...(visibility ? { profileVisibility: visibility } : {}), ...(typeof body.showStatsPublic === "boolean" ? { showStatsPublic: body.showStatsPublic } : {}), ...(typeof body.allowChallenges === "boolean" ? { allowChallenges: body.allowChallenges } : {}), ...(typeof body.allowMessages === "boolean" ? { allowMessages: body.allowMessages } : {}) }, select: { profileVisibility:true, showStatsPublic:true, allowChallenges:true, allowMessages:true } });
    return NextResponse.json({ user: updated });
  }
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
