import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword, newSessionToken, sessionCookieOptions, hashToken } from "@/lib/auth";
import { enforceIpRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-meta";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  try {
    await prisma.$transaction((tx) => enforceIpRateLimit(tx, ip, "LOGIN", 20, 10 * 60_000));
  } catch (e) {
    if (e instanceof Error && e.message === "RATE_LIMITED") return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    throw e;
  }

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  if (user.status !== "ACTIVE") return NextResponse.json({ error: "Account disabled" }, { status: 403 });
  if (!user.emailVerifiedAt) return NextResponse.json({ error: "Email not verified" }, { status: 403 });

  const token = newSessionToken();
  await prisma.userSession.create({ data: { userId: user.id, token: hashToken(token), ipAddress: ip, userAgent: request.headers.get("user-agent") ?? "unknown", expiresAt: new Date(Date.now() + 30 * 86400000) } });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const res = NextResponse.json({ ok: true });
  res.cookies.set({ ...sessionCookieOptions(), value: token });
  return res;
}
