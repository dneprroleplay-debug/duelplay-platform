import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashToken, SESSION_COOKIE } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const session = await prisma.userSession.findFirst({
    where: {
      token: hashToken(token),
      isRevoked: false,
      expiresAt: { gt: now },
    },
    select: { id: true, userId: true },
  });

  if (!session) return NextResponse.json({ ok: false, error: "Session invalid or expired" }, { status: 401 });

  await prisma.userSession.update({
    where: { id: session.id },
    data: { lastActiveAt: now },
  });

  return NextResponse.json({ ok: true, activeAt: now.toISOString() });
}
