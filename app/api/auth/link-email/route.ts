import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { hashCode, sendEmail } from "@/lib/email";
import { enforceIpRateLimit, enforceRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-meta";
import { isSameOriginRequest } from "@/lib/steam-link-security";

function emailHtml(nickname: string, link: string) {
  const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] || c);
  const safeName = escapeHtml(nickname);
  const safeLink = escapeHtml(link);
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>DuelPlay — Подтверди Email</title></head><body style="margin:0;padding:0;background-color:#08080d;font-family:Arial,Helvetica,sans-serif;color:#f7f7fb;-webkit-text-size-adjust:100%;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#08080d;width:100%;"><tr><td align="center" style="padding:28px 12px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;background-color:#111119;border:1px solid #302438;border-radius:18px;overflow:hidden;"><tr><td style="padding:28px 28px 8px;"><div style="font-size:12px;line-height:18px;font-weight:800;letter-spacing:3px;color:#ff75b5;">DUEL<span style="color:#f2c96d;">PLAY</span></div><div style="margin-top:18px;height:2px;width:56px;background-color:#f2c96d;"></div><h1 style="margin:22px 0 12px;font-size:28px;line-height:1.2;letter-spacing:-.5px;color:#ffffff;">Подтверди Email</h1><p style="margin:0;font-size:15px;line-height:1.75;color:#c8c4d1;">Привет, <strong style="color:#ffffff;">${safeName}</strong>!</p><p style="margin:12px 0 0;font-size:15px;line-height:1.75;color:#c8c4d1;">Подтверди адрес электронной почты, чтобы привязать его к своему аккаунту DuelPlay и защитить доступ к профилю.</p></td></tr><tr><td align="left" style="padding:24px 28px 12px;"><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" bgcolor="#ff75b5" style="border-radius:10px;background-color:#ff75b5;"><a href="${safeLink}" style="display:inline-block;padding:15px 24px;border:1px solid #ff75b5;border-radius:10px;color:#1b0712;font-size:14px;line-height:18px;font-weight:800;text-decoration:none;">Подтвердить Email</a></td></tr></table><p style="margin:18px 0 0;font-size:12px;line-height:1.7;color:#a7a1b1;">Ссылка действует <strong style="color:#f2c96d;">10 минут</strong> и может быть использована только один раз.</p></td></tr><tr><td style="padding:12px 28px 26px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#191720;border:1px solid #302438;border-radius:12px;"><tr><td style="padding:14px 16px;"><p style="margin:0 0 5px;font-size:12px;line-height:18px;font-weight:800;color:#f2c96d;">Безопасность аккаунта</p><p style="margin:0;font-size:12px;line-height:1.7;color:#aaa5b4;">Если ты не запрашивал подтверждение, просто проигнорируй это письмо. Не пересылай ссылку другим людям.</p></td></tr></table><p style="margin:22px 0 0;font-size:12px;line-height:1.7;color:#898493;">Нужна помощь? Напиши нам: <a href="mailto:support@duelplaygame.com" style="color:#ff8fc4;text-decoration:underline;">support@duelplaygame.com</a></p><p style="margin:14px 0 0;font-size:11px;line-height:1.6;color:#686474;">DuelPlay · Играй честно. Сражайся достойно.</p></td></tr></table><p style="max-width:560px;margin:14px auto 0;font-size:11px;line-height:1.6;text-align:center;color:#625d6c;">Если кнопка не работает, открой ссылку из письма в браузере: <a href="${safeLink}" style="color:#ff8fc4;word-break:break-all;">подтвердить Email</a>.</p></td></tr></table></body></html>`;
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request.headers.get("origin"), (process.env.DUELPLAY_PUBLIC_URL || process.env.NEXT_PUBLIC_SITE_URL || (process.env.NODE_ENV === "production" ? "https://duelplaygame.com" : new URL(request.url).origin)).replace(/\/$/, ""))) return NextResponse.json({ error: "CROSS_ORIGIN_REQUEST" }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  if (user.status !== "ACTIVE" || user.deletedAt) return NextResponse.json({ error: "ACCOUNT_DISABLED" }, { status: 403 });
  const ip = getClientIp(request);
  try {
    await prisma.$transaction(async (tx) => {
      await enforceIpRateLimit(tx, ip, "EMAIL_LINK_IP", 8, 10 * 60_000);
      await enforceRateLimit(tx, user.id, "EMAIL_LINK_USER", 5, 60 * 60_000);
    });
  } catch (error) {
    if (error instanceof Error && error.message === "RATE_LIMITED") return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    throw error;
  }

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 }); }
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "INVALID_EMAIL" }, { status: 400 });
  if (user.email?.toLowerCase() === email && user.emailVerifiedAt) return NextResponse.json({ ok: true, alreadyVerified: true });

  const token = randomBytes(32).toString("hex");
  const now = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      const owner = await tx.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } });
      if (owner && owner.id !== user.id) throw new Error("EMAIL_CONFLICT");
      await tx.emailVerificationCode.updateMany({ where: { userId: user.id, purpose: "EMAIL_LINK", usedAt: null }, data: { usedAt: now } });
      await tx.emailVerificationCode.create({ data: { userId: user.id, email, purpose: "EMAIL_LINK", codeHash: hashCode(token), expiresAt: new Date(now.getTime() + 10 * 60_000), ipAddress: ip } });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "EMAIL_CONFLICT") return NextResponse.json({ error: "EMAIL_UNAVAILABLE" }, { status: 409 });
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") return NextResponse.json({ error: "EMAIL_UNAVAILABLE" }, { status: 409 });
    throw error;
  }

  const base = (process.env.DUELPLAY_PUBLIC_URL || process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || (process.env.NODE_ENV === "production" ? "https://duelplaygame.com" : new URL(request.url).origin)).replace(/\/$/, "");
  const link = `${base}/profile#email-link=${token}`;
  try {
    await sendEmail({ from: "DuelPlay <verify@duelplaygame.com>", to: email, subject: "Подтверди Email для DuelPlay", html: emailHtml(user.nickname, link), text: `Привет, ${user.nickname}!

Подтверди адрес электронной почты, чтобы привязать его к аккаунту DuelPlay: ${link}

Ссылка действует 10 минут и используется один раз. Если ты не запрашивал подтверждение, проигнорируй это письмо.

Поддержка DuelPlay: support@duelplaygame.com` });
  } catch {
    await prisma.emailVerificationCode.updateMany({ where: { userId: user.id, purpose: "EMAIL_LINK", codeHash: hashCode(token), usedAt: null }, data: { usedAt: new Date() } }).catch(() => undefined);
    return NextResponse.json({ error: "EMAIL_DELIVERY_FAILED" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, pending: true });
}
