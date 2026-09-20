import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashToken, newSessionToken, sessionCookieOptions } from "@/lib/auth";
import { ensureTestAccounts, TEST_ACCOUNTS } from "@/lib/test-accounts";
import { enforceIpRateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  try {
    await prisma.$transaction(tx => enforceIpRateLimit(tx, ip, "TEST_LOGIN", 5, 10 * 60_000));
  } catch (error) {
    if (error instanceof Error && error.message === "RATE_LIMITED") return NextResponse.json({ error: "Слишком много попыток входа. Попробуйте позже." }, { status: 429 });
    throw error;
  }
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
    await prisma.userSession.create({ data: { userId: user.id, token: hashToken(token), ipAddress, userAgent, expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24) } });

    const response = NextResponse.json({ ok: true, nickname: user.nickname });
    response.cookies.set({ ...sessionCookieOptions(), value: token, maxAge: 60 * 60 * 24 });
    return response;
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Не удалось выполнить тестовый вход" }, { status: 500 });
  }
}
