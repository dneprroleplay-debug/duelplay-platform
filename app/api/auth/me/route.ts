import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/auth";
export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ user: null });
  const session = await prisma.userSession.findFirst({ where: { token: hashToken(token), isRevoked: false, expiresAt: { gt: new Date() } }, include: { user: { include: { wallet: true, adminRoleAssignment: true } } } });
  if (!session) return NextResponse.json({ user: null });
  const ownerSteam = process.env.DUELPLAY_OWNER_STEAM_ID?.trim();
  const founder = Boolean((ownerSteam && session.user.steamId === ownerSteam) || session.user.nickname === "DuelPlayOwner");
  const effectiveRole = founder ? "FOUNDER" : (session.user.adminRoleAssignment?.roleCode || session.user.role);
  return NextResponse.json({ user: { id: session.user.id, role: effectiveRole, nickname: session.user.nickname, steamId: session.user.steamId, email: session.user.email, avatarUrl: session.user.avatarUrl, steamAvatarUrl: session.user.steamAvatarUrl, themePreference: session.user.themePreference, balance: session.user.wallet?.balance.toString() ?? "0", lockedBalance: session.user.wallet?.lockedBalance.toString() ?? "0", reputation: session.user.reputation, level: session.user.level, xp: session.user.xp } });
}

