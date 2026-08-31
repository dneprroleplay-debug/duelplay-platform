import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { newSessionToken, sessionCookieOptions, verifyPassword } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const login = String(body.login ?? "").trim();
    const password = String(body.password ?? "");
    const normalizedEmail = login.toLowerCase();
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: normalizedEmail },
          { nickname: { equals: login, mode: "insensitive" } }
        ]
      }
    });

    if (!user?.passwordHash || !verifyPassword(password, user.passwordHash)) return NextResponse.json({ error: "Неверный никнейм/email или пароль" }, { status: 401 });
    if (user.status !== "ACTIVE") return NextResponse.json({ error: "Аккаунт недоступен" }, { status: 403 });
    const token = newSessionToken();
    await prisma.userSession.create({ data: { userId: user.id, token, ipAddress: "local", userAgent: request.headers.get("user-agent") ?? "unknown", expiresAt: new Date(Date.now() + 30 * 86400000) } });
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const response = NextResponse.json({ user: { id: user.id, nickname: user.nickname, email: user.email, avatarUrl: user.avatarUrl } });
    response.cookies.set({ ...sessionCookieOptions(), value: token });
    return response;
  } catch (error) { console.error(error); return NextResponse.json({ error: "Не удалось войти" }, { status: 500 }); }
}
