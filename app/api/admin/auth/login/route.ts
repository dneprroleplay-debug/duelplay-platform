import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashToken, newSessionToken, sessionCookieOptions, verifyPassword } from "@/lib/auth";
import { enforceIpRateLimit, enforceRateLimit } from "@/lib/rate-limit";
import { adminLevel } from "@/lib/admin";
import { adminAuthCookieOptions, createAdminAuthValue } from "@/lib/admin-auth";

export async function POST(request: NextRequest) {
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  try {
    await prisma.$transaction(tx => enforceIpRateLimit(tx, ip, "ADMIN_LOGIN", 10, 10 * 60_000));
    const body = await request.json().catch(() => ({}));
    const nickname = String(body.nickname || "").trim().slice(0, 40);
    const password = String(body.password || "");
    if (!nickname || password.length < 12 || password.length > 256) return NextResponse.json({ error: "Неверные учётные данные." }, { status: 401 });

    const user = await prisma.user.findUnique({ where: { nickname }, select: { id: true, nickname: true, role: true, status: true, passwordHash: true } });
    if (!user || adminLevel(user.role) < 1 || user.status !== "ACTIVE" || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
      try {
        await prisma.securityEvent.create({ data: { userId: user?.id ?? null, eventType: "ADMIN_LOGIN_FAILED", severity: "WARNING", ipAddress: ip, metadata: { reason: "INVALID_CREDENTIALS" } } });
      } catch {}
      if (user) {
        try {
          await prisma.$transaction(tx => enforceRateLimit(tx, user.id, "ADMIN_LOGIN_FAILED", 10, 10 * 60_000));
        } catch (error) {
          if (error instanceof Error && error.message === "RATE_LIMITED") return NextResponse.json({ error: "Слишком много неудачных попыток для этой учётной записи. Попробуйте позже." }, { status: 429 });
          throw error;
        }
      }
      return NextResponse.json({ error: "Неверные учётные данные." }, { status: 401 });
    }

    const token = newSessionToken();
    const session = await prisma.userSession.create({
      data: {
        userId: user.id,
        token: hashToken(token),
        ipAddress: ip,
        userAgent: request.headers.get("user-agent") || "admin-login",
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    await prisma.securityEvent.create({ data: { userId: user.id, eventType: "ADMIN_LOGIN_SUCCESS", severity: "INFO", ipAddress: ip, metadata: { role: user.role } } });

    const response = NextResponse.json({ ok: true, nickname: user.nickname, mfaRequired: true });
    response.cookies.set({ ...sessionCookieOptions(), value: token });
    response.cookies.set({ ...adminAuthCookieOptions(), value: createAdminAuthValue(session.id, user.id) });
    return response;
  } catch (error) {
    if (error instanceof Error && error.message === "RATE_LIMITED") return NextResponse.json({ error: "Слишком много попыток входа. Попробуйте позже." }, { status: 429 });
    console.error(error);
    return NextResponse.json({ error: "Вход администратора временно недоступен." }, { status: 503 });
  }
}
