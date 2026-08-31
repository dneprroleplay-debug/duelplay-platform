import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, newSessionToken, sessionCookieOptions } from "@/lib/auth";

const DEFAULT_AVATARS = ["/avatars/premium/01-cyan.svg", "/avatars/premium/02-violet.svg", "/avatars/premium/03-red.svg", "/avatars/premium/04-amber.svg", "/avatars/premium/05-emerald.svg", "/avatars/premium/06-blue.svg", "/avatars/premium/07-pink.svg", "/avatars/premium/08-orange.svg"];

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const nickname = String(body.nickname ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const referralCode = String(body.referralCode ?? "").trim().toUpperCase();
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(nickname)) return NextResponse.json({ error: "Никнейм: 3–20 символов, только латиница, цифры и _" }, { status: 400 });
    if (!/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ error: "Введите корректный email" }, { status: 400 });
    if (password.length < 8) return NextResponse.json({ error: "Пароль должен быть не короче 8 символов" }, { status: 400 });
    const exists = await prisma.user.findFirst({ where: { OR: [{ nickname }, { email }] }, select: { nickname: true, email: true } });
    if (exists?.nickname === nickname) return NextResponse.json({ error: "Этот никнейм уже занят" }, { status: 409 });
    if (exists?.email === email) return NextResponse.json({ error: "Этот email уже зарегистрирован" }, { status: 409 });

    let referredById: string | undefined;
    if (referralCode) {
      const referrer = await prisma.user.findUnique({ where: { referralCode }, select: { id: true } });
      if (!referrer) return NextResponse.json({ error: "Реферальный код не найден" }, { status: 400 });
      referredById = referrer.id;
    }

    const user = await prisma.user.create({ data: { nickname, email, passwordHash: hashPassword(password), avatarUrl: DEFAULT_AVATARS[Math.floor(Math.random() * DEFAULT_AVATARS.length)], referralCode: `DP${newSessionToken().slice(0, 8).toUpperCase()}`, referredById, wallet: { create: {} } }, select: { id: true, nickname: true, email: true, avatarUrl: true } });
    const token = newSessionToken();
    await prisma.userSession.create({ data: { userId: user.id, token, ipAddress: "local", userAgent: request.headers.get("user-agent") ?? "unknown", expiresAt: new Date(Date.now() + 30 * 86400000) } });
    const response = NextResponse.json({ user }, { status: 201 });
    response.cookies.set({ ...sessionCookieOptions(), value: token });
    return response;
  } catch (error) { console.error(error); return NextResponse.json({ error: "Не удалось зарегистрировать аккаунт" }, { status: 500 }); }
}
