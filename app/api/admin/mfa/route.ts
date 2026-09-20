import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminLevel } from "@/lib/admin";
import { getCurrentAdminSession } from "@/lib/admin-auth";
import { buildOtpAuthUri, generateTotpSecret, verifyTotp } from "@/lib/totp";
import { decryptSecret, encryptSecret } from "@/lib/secret-crypto";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getAuditContext } from "@/lib/request-meta";

function responseMessage(errorCode: string) {
  if (errorCode === "MFA_ENCRYPTION_KEY_MISSING") return "MFA encryption key is not configured on the server.";
  if (errorCode === "ADMIN_MFA_SETUP_REQUIRED") return "Set up an authenticator before using the admin panel.";
  return "Admin MFA request failed.";
}

export async function GET() {
  try {
    const session = await getCurrentAdminSession();
    if (!session?.user) return NextResponse.json({ error: "Требуется вход администратора", errorCode: "ADMIN_LOGIN_REQUIRED" }, { status: 401 });
    if (adminLevel(session.user.role) < 1) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    return NextResponse.json({
      enabled: session.user.twoFactorEnabled,
      verified: Boolean(session.adminMfaVerifiedAt && Date.now() - session.adminMfaVerifiedAt.getTime() <= 8 * 60 * 60 * 1000),
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return NextResponse.json({ error: responseMessage(code) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getCurrentAdminSession();
    if (!session?.user) return NextResponse.json({ error: "Требуется вход администратора", errorCode: "ADMIN_LOGIN_REQUIRED" }, { status: 401 });
    if (adminLevel(session.user.role) < 1) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "setup") {
      await prisma.$transaction(tx => enforceRateLimit(tx, session.user.id, "ADMIN_MFA_SETUP", 3, 10 * 60_000));
      if (session.user.twoFactorEnabled) return NextResponse.json({ error: "MFA уже включена." }, { status: 409 });
      const secret = generateTotpSecret();
      const encrypted = encryptSecret(secret);
      const auditContext = getAuditContext(request);
      await prisma.$transaction(async tx => {
        await tx.user.update({ where: { id: session.user.id }, data: { twoFactorSecret: encrypted, twoFactorEnabled: false } });
        await tx.auditLog.create({ data: { userId: session.user.id, action: "ADMIN_MFA_SETUP", targetType: "USER", targetId: session.user.id, ipAddress: auditContext.ipAddress, userAgent: auditContext.userAgent, requestId: auditContext.requestId, result: "SUCCESS", payload: {} } });
      });
      return NextResponse.json({ ok: true, secret, otpauthUri: buildOtpAuthUri(secret, session.user.nickname) }, { headers: { "Cache-Control": "no-store" } });
    }

    if (action === "verify") {
      await prisma.$transaction(tx => enforceRateLimit(tx, session.user.id, "ADMIN_MFA_VERIFY", 5, 5 * 60_000));
      const code = String(body.code || "").trim();
      if (!/^\d{6}$/.test(code)) return NextResponse.json({ error: "Код должен содержать 6 цифр." }, { status: 400 });
      const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, nickname: true, twoFactorEnabled: true, twoFactorSecret: true } });
      if (!user?.twoFactorSecret) return NextResponse.json({ error: "Сначала создайте настройку MFA." }, { status: 409 });
      const secret = decryptSecret(user.twoFactorSecret);
      if (!verifyTotp(secret, code)) {
        await prisma.securityEvent.create({ data: { userId: user.id, eventType: "ADMIN_MFA_FAILED", severity: "WARNING", ipAddress: request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "application", metadata: { reason: "INVALID_TOTP" } } });
        return NextResponse.json({ error: "Неверный код MFA." }, { status: 401 });
      }

      await prisma.$transaction(async tx => {
        await tx.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
        await tx.userSession.update({ where: { id: session.id }, data: { adminMfaVerifiedAt: new Date() } });
        const auditContext = getAuditContext(request);
        await tx.auditLog.create({ data: { userId: user.id, action: user.twoFactorEnabled ? "ADMIN_MFA_VERIFIED" : "ADMIN_MFA_ENABLED", targetType: "USER", targetId: user.id, ipAddress: auditContext.ipAddress, userAgent: auditContext.userAgent, requestId: auditContext.requestId, result: "SUCCESS", payload: {} } });
      });
      return NextResponse.json({ ok: true, enabled: true, verified: true }, { headers: { "Cache-Control": "no-store" } });
    }

    return NextResponse.json({ error: "Неизвестное действие MFA." }, { status: 400 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "MFA_ENCRYPTION_KEY_MISSING") return NextResponse.json({ error: responseMessage(code), errorCode: code }, { status: 503 });
    console.error(error);
    return NextResponse.json({ error: responseMessage(code) }, { status: 500 });
  }
}
