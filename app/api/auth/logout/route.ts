import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashToken, SESSION_COOKIE } from "@/lib/auth";
import { ADMIN_AUTH_COOKIE } from "@/lib/admin-auth";
import { getClientIp } from "@/lib/request-meta";
export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    const session = await prisma.userSession.findFirst({ where: { token: hashToken(token), isRevoked: false }, select: { userId: true } });
    await prisma.userSession.updateMany({ where: { token: hashToken(token) }, data: { isRevoked: true } });
    if (session) {
      await prisma.securityEvent.create({ data: { userId: session.userId, eventType: "LOGOUT", severity: "INFO", ipAddress: getClientIp(request), metadata: {} } }).catch(() => {});
    }
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  response.cookies.set({ name: ADMIN_AUTH_COOKIE, value: "", httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
  return response;
}
