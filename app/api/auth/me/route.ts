import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE } from "@/lib/auth";
export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ user: null });
  const session = await prisma.userSession.findFirst({ where: { token, isRevoked: false, expiresAt: { gt: new Date() } }, include: { user: { include: { wallet: true } } } });
  if (!session) return NextResponse.json({ user: null });
  return NextResponse.json({ user: { id: session.user.id, role: session.user.role, nickname: session.user.nickname, email: session.user.email, avatarUrl: session.user.avatarUrl, balance: session.user.wallet?.balance.toString() ?? "0", lockedBalance: session.user.wallet?.lockedBalance.toString() ?? "0", reputation: session.user.reputation, level: session.user.level, xp: session.user.xp } });
}

