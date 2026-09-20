import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, hashToken } from "@/lib/auth";
import { ADMIN_INVITE_PREFIX } from "@/lib/admin-auth";
import { enforceIpRateLimit } from "@/lib/rate-limit";

function getToken(request: NextRequest) {
  return String(new URL(request.url).searchParams.get("token") || "").trim();
}

export async function GET(request: NextRequest) {
  const token = getToken(request);
  if (!/^[0-9a-f]{64}$/i.test(token)) return NextResponse.json({ error: "Недействительная ссылка приглашения." }, { status: 400 });
  const invite = await prisma.userSession.findFirst({
    where: { token: `${ADMIN_INVITE_PREFIX}${hashToken(token)}`, isRevoked: false, ipAddress: "ADMIN_INVITE", expiresAt: { gt: new Date() } },
    include: { user: { select: { id: true, nickname: true, role: true, status: true } } },
  });
  if (!invite || invite.user.status !== "ACTIVE") return NextResponse.json({ error: "Ссылка приглашения недействительна или просрочена." }, { status: 410 });
  return NextResponse.json({ ok: true, nickname: invite.user.nickname, role: invite.user.role, expiresAt: invite.expiresAt }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  try {
    await prisma.$transaction(tx => enforceIpRateLimit(tx, ip, "ADMIN_PASSWORD_SETUP", 5, 10 * 60_000));
    const body = await request.json().catch(() => ({}));
    const token = String(body.token || "").trim();
    const password = String(body.password || "");
    const confirm = String(body.confirmPassword || "");
    if (!/^[0-9a-f]{64}$/i.test(token)) return NextResponse.json({ error: "Недействительная ссылка приглашения." }, { status: 400 });
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{12,128}$/.test(password)) return NextResponse.json({ error: "Пароль: минимум 12 символов, включая заглавную, строчную, цифру и специальный символ." }, { status: 400 });
    if (password !== confirm) return NextResponse.json({ error: "Пароли не совпадают." }, { status: 400 });

    const invite = await prisma.userSession.findFirst({
      where: { token: `${ADMIN_INVITE_PREFIX}${hashToken(token)}`, isRevoked: false, ipAddress: "ADMIN_INVITE", expiresAt: { gt: new Date() } },
      include: { user: { select: { id: true, nickname: true, role: true, status: true } } },
    });
    if (!invite || invite.user.status !== "ACTIVE") return NextResponse.json({ error: "Ссылка приглашения недействительна или просрочена." }, { status: 410 });

    const passwordHash = hashPassword(password);
    await prisma.$transaction(async tx => {
      await tx.user.update({ where: { id: invite.user.id }, data: { passwordHash } });
      await tx.userSession.update({ where: { id: invite.id }, data: { isRevoked: true } });
      await tx.userSession.updateMany({ where: { userId: invite.user.id, isRevoked: false, ipAddress: { not: "ADMIN_INVITE" } }, data: { isRevoked: true } });
      await tx.auditLog.create({ data: { userId: invite.user.id, action: "ADMIN_PASSWORD_SET", targetType: "USER", targetId: invite.user.id, ipAddress: ip, userAgent: request.headers.get("user-agent") || "admin-password-setup", payload: { role: invite.user.role } } });
      await tx.securityEvent.create({ data: { userId: invite.user.id, eventType: "ADMIN_PASSWORD_SET", severity: "INFO", ipAddress: ip, metadata: { role: invite.user.role } } });
    });
    return NextResponse.json({ ok: true, nickname: invite.user.nickname });
  } catch (error) {
    if (error instanceof Error && error.message === "RATE_LIMITED") return NextResponse.json({ error: "Слишком много попыток. Попробуйте позже." }, { status: 429 });
    console.error(error);
    return NextResponse.json({ error: "Не удалось установить пароль." }, { status: 503 });
  }
}
