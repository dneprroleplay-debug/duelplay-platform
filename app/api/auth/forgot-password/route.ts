import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashResetToken, generateResetToken, sendEmail } from "@/lib/email";
import { enforceIpRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-meta";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  try {
    await prisma.$transaction((tx) => enforceIpRateLimit(tx, ip, "FORGOT_PASSWORD", 10, 10 * 60_000));
  } catch (e) {
    if (e instanceof Error && e.message === "RATE_LIMITED") return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    throw e;
  }
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const email = String(body.email || "").trim().toLowerCase();

  const user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    await prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
    const token = generateResetToken();
    await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: hashResetToken(token), expiresAt: new Date(Date.now() + 60 * 60_000), ipAddress: ip } });
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "") || "https://duelplaygame.com";
    const link = `${baseUrl}/reset-password?token=${token}`;
    try {
      await sendEmail({ from: "DuelPlay Security <security@duelplaygame.com>", to: email, subject: "Сброс пароля DuelPlay", html: `<div style="background:#0a0a0f;color:#fff;padding:24px"><h1>Привет, ${user.nickname}!</h1><p>Сброс пароля: <a href="${link}">Сбросить пароль</a></p><p>Ссылка: ${link}</p></div>`, text: `Ссылка: ${link}` });
    } catch (e) { console.error(e); }
  }

  return NextResponse.json({ ok: true });
}
