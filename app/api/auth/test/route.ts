import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { newSessionToken, sessionCookieOptions } from "@/lib/auth";
import { ensureTestAccounts, TEST_ACCOUNTS } from "@/lib/test-accounts";

export async function POST(request: NextRequest) {
  const configuredSecret = process.env.DUELPLAY_TEST_ACCOUNTS_SECRET?.trim();
  if (!configuredSecret) return NextResponse.json({ error: "Тестовый вход не настроен" }, { status: 404 });
  try {
    const body = await request.json();
    const secret = String(body.secret || "");
    const key = String(body.player || "");
    if (secret !== configuredSecret) return NextResponse.json({ error: "Неверный тестовый ключ" }, { status: 403 });
    if (!TEST_ACCOUNTS.some((x) => x.key === key)) return NextResponse.json({ error: "Неизвестный тестовый игрок" }, { status: 400 });

    const accounts = await ensureTestAccounts();
    const index = TEST_ACCOUNTS.findIndex((x) => x.key === key);
    const user = accounts[index];
    const token = newSessionToken();
    const forwarded = request.headers.get("x-forwarded-for") || "unknown";
    const ipAddress = forwarded.split(",")[0]?.trim() || "unknown";
    const userAgent = request.headers.get("user-agent") || "DuelPlay test login";
    await prisma.userSession.create({ data: { userId: user.id, token, ipAddress, userAgent, expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24) } });

    const response = NextResponse.json({ ok: true, nickname: user.nickname });
    response.cookies.set({ ...sessionCookieOptions(), value: token, maxAge: 60 * 60 * 24 });
    return response;
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Не удалось выполнить тестовый вход" }, { status: 500 });
  }
}
