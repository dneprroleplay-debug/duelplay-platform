import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { hashCode, sendEmail } from "@/lib/email";
import { enforceIpRateLimit, enforceRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-meta";
import { isSameOriginRequest } from "@/lib/steam-link-security";

function emailHtml(nickname: string, link: string) {
  const safeName = nickname.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] || c);
  const safeLink = link.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<!doctype html><html><body style="margin:0;background:#08080c;color:#f7f7fb;font-family:Arial,sans-serif;padding:28px"><main style="max-width:560px;margin:auto;padding:28px;background:#111017;border:1px solid #302331;border-radius:18px"><b style="color:#ff75b5">DUELPLAY</b><h1>Подтверди Email</h1><p>Привет, ${safeName}! Нажми кнопку ниже, чтобы привязать этот Email к своему аккаунту DuelPlay. Ссылка действует 10 минут и используется один раз.</p><p><a href="${safeLink}" style="display:inline-block;padding:13px 18px;background:#ff2f91;color:#190712;font-weight:bold;text-decoration:none;border-radius:10px">Подтвердить Email</a></p><p style="color:#999;font-size:12px">Если ты не запрашивал привязку, проигнорируй письмо. Не пересылай ссылку другим людям.</p></main></body></html>`;
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request.headers.get("origin"), new URL(request.url).origin)) return NextResponse.json({ error: "CROSS_ORIGIN_REQUEST" }, { status: 403 });
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

  const base = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/$/, "");
  const link = `${base}/profile#email-link=${token}`;
  try {
    await sendEmail({ from: "DuelPlay <verify@duelplaygame.com>", to: email, subject: "Подтверди Email для DuelPlay", html: emailHtml(user.nickname, link), text: `Привет, ${user.nickname}! Подтверди привязку Email по ссылке: ${link}. Ссылка действует 10 минут и используется один раз.` });
  } catch {
    await prisma.emailVerificationCode.updateMany({ where: { userId: user.id, purpose: "EMAIL_LINK", codeHash: hashCode(token), usedAt: null }, data: { usedAt: new Date() } }).catch(() => undefined);
    return NextResponse.json({ error: "EMAIL_DELIVERY_FAILED" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, pending: true });
}
