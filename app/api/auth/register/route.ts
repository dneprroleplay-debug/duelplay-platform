import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, newSessionToken } from "@/lib/auth";
import { hashCode, generateVerificationCode, sendEmail } from "@/lib/email";
import { verificationEmailHtml } from "@/lib/auth-email-templates";
import { normalizeNickname, validateNickname } from "@/lib/nickname";
import { enforceIpRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-meta";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  try {
    await prisma.$transaction((tx) => enforceIpRateLimit(tx, ip, "REGISTER", 10, 10 * 60_000));
  } catch (e) {
    if (e instanceof Error && e.message === "RATE_LIMITED") return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    throw e;
  }

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const nickname = String(body.nickname || "").trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "Password too short" }, { status: 400 });
  if (!validateNickname(nickname)) return NextResponse.json({ error: "Invalid nickname" }, { status: 400 });

  const normalized = normalizeNickname(nickname);

  try {
    const user = await prisma.$transaction(async (tx) => {
      const existingEmail = await tx.user.findUnique({ where: { email } });
      if (existingEmail) throw new Error("EMAIL_TAKEN");
      const existingNick = await tx.user.findFirst({ where: { OR: [{ nicknameNormalized: normalized }, { nickname: { equals: nickname, mode: "insensitive" } }] } });
      if (existingNick) throw new Error("NICKNAME_TAKEN");

      const passwordHash = hashPassword(password);
      const referralCode = `DP${newSessionToken().slice(0, 8).toUpperCase()}`;
      const u = await tx.user.create({
        data: { email, passwordHash, nickname, nicknameNormalized: normalized, referralCode, wallet: { create: {} } },
      });

      // invalidate previous codes
      await tx.emailVerificationCode.updateMany({ where: { email, usedAt: null }, data: { usedAt: new Date() } });
      const code = generateVerificationCode();
      await tx.emailVerificationCode.create({
        data: { userId: u.id, email, codeHash: hashCode(code), purpose: "REGISTER", expiresAt: new Date(Date.now() + 10 * 60_000), ipAddress: ip },
      });
      return { user: u, code };
    });

    try {
      const html = verificationEmailHtml(nickname, user.code);
      await sendEmail({ from: "DuelPlay <verify@duelplaygame.com>", to: email, subject: "Твой код подтверждения DuelPlay", html, text: `Привет, ${nickname}! Твой код подтверждения: ${user.code}. Код действует 10 минут. Если ты не создавал аккаунт, проигнорируй это письмо.` });
    } catch (e) {
      console.error("email send failed", e);
      return NextResponse.json({ ok: false, emailSent: false, userId: user.user.id, error: "Email delivery failed" }, { status: 502 });
    }

    return NextResponse.json({ ok: true, emailSent: true, userId: user.user.id });
  } catch (e) {
    if (e instanceof Error && e.message === "EMAIL_TAKEN") return NextResponse.json({ error: "Email already registered" }, { status: 409 });
    if (e instanceof Error && e.message === "NICKNAME_TAKEN") return NextResponse.json({ error: "Nickname already taken" }, { status: 409 });
    console.error(e);
    return NextResponse.json({ error: "Registration failed" }, { status: 500 });
  }
}
