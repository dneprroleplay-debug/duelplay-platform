import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashCode, generateVerificationCode, sendEmail } from "@/lib/email";
import { verificationEmailHtml } from "@/lib/auth-email-templates";
import { enforceIpRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-meta";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  try {
    await prisma.$transaction((tx) => enforceIpRateLimit(tx, ip, "RESEND_VERIFY", 5, 10 * 60_000));
  } catch (e) {
    if (e instanceof Error && e.message === "RATE_LIMITED") return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    throw e;
  }
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const email = String(body.email || "").trim().toLowerCase();

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return NextResponse.json({ ok: true }); // don't reveal

  // cooldown: last code within 60s
  const last = await prisma.emailVerificationCode.findFirst({ where: { email, purpose: "REGISTER" }, orderBy: { createdAt: "desc" } });
  if (last && Date.now() - last.createdAt.getTime() < 60_000) {
    return NextResponse.json({ error: "Please wait before resending" }, { status: 429 });
  }

  await prisma.emailVerificationCode.updateMany({ where: { email, usedAt: null }, data: { usedAt: new Date() } });
  const code = generateVerificationCode();
  await prisma.emailVerificationCode.create({ data: { userId: user.id, email, codeHash: hashCode(code), purpose: "REGISTER", expiresAt: new Date(Date.now() + 10 * 60_000), ipAddress: ip } });

  try {
    await sendEmail({ from: "DuelPlay <verify@duelplaygame.com>", to: email, subject: "Твой новый код подтверждения DuelPlay", html: verificationEmailHtml(user.nickname, code), text: `Привет, ${user.nickname}! Твой новый код подтверждения: ${code}. Код действует 10 минут.` });
  } catch (e) { console.error(e); }

  return NextResponse.json({ ok: true });
}
