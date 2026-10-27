import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashCode } from "@/lib/email";
import { enforceIpRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-meta";
import { findAvailableRecoveryForEmail } from "@/lib/account-recovery";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  try {
    await prisma.$transaction((tx) => enforceIpRateLimit(tx, ip, "VERIFY_EMAIL", 20, 10 * 60_000));
  } catch (e) {
    if (e instanceof Error && e.message === "RATE_LIMITED") return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    throw e;
  }

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const email = String(body.email || "").trim().toLowerCase();
  const code = String(body.code || "").trim().toUpperCase();

  const record = await prisma.emailVerificationCode.findFirst({
    where: { email, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!record) return NextResponse.json({ error: "Code expired or not found" }, { status: 400 });

  // atomic increment + check attempts
  const updated = await prisma.emailVerificationCode.updateMany({
    where: { id: record.id, usedAt: null, attempts: { lt: 5 } },
    data: { attempts: { increment: 1 } },
  });
  if (updated.count === 0) return NextResponse.json({ error: "Too many attempts" }, { status: 429 });

  // re-read
  const fresh = await prisma.emailVerificationCode.findUnique({ where: { id: record.id } });
  if (!fresh || hashCode(code) !== fresh.codeHash) {
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  }

  const result = await prisma.emailVerificationCode.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (result.count === 0) return NextResponse.json({ error: "Code already used" }, { status: 400 });

  if (record.userId) {
    await prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } });
  } else {
    await prisma.user.updateMany({ where: { email }, data: { emailVerifiedAt: new Date() } });
  }

  // Only report a recovery opportunity after the email code was successfully consumed,
  // and only when the protected positive REAL balance is still backed by its hold ledger.
  let recoveryAvailable = false;
  try { recoveryAvailable = Boolean(await findAvailableRecoveryForEmail(prisma, email)); }
  catch (error) {
    // Missing recovery HMAC configuration must never leak identity or break ordinary email verification.
    if (!(error instanceof Error) || !error.message.includes("ACCOUNT_RECOVERY_SECRET_REQUIRED")) throw error;
  }
  return NextResponse.json({
    ok: true,
    recoveryAvailable,
    recoveryMessage: recoveryAvailable ? "У вас есть удалённый аккаунт DuelPlay с доступным для восстановления балансом. Чтобы подтвердить владение прежним аккаунтом, привяжите тот же Steam, который использовался ранее." : undefined,
  }, { headers: { "Cache-Control": "no-store" } });
}
