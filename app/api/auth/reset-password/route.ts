import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { hashResetToken } from "@/lib/email";
import { enforceIpRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-meta";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  try {
    await prisma.$transaction((tx) => enforceIpRateLimit(tx, ip, "RESET_PASSWORD", 10, 10 * 60_000));
  } catch (e) {
    if (e instanceof Error && e.message === "RATE_LIMITED") return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    throw e;
  }
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const token = String(body.token || "");
  const password = String(body.password || "");
  if (password.length < 8) return NextResponse.json({ error: "Password too short" }, { status: 400 });

  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashResetToken(token) } });
  if (!record || record.usedAt || record.expiresAt < new Date()) return NextResponse.json({ error: "Invalid or expired token" }, { status: 400 });

  await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
    await tx.user.update({ where: { id: record.userId }, data: { passwordHash: hashPassword(password) } });
    await tx.userSession.updateMany({ where: { userId: record.userId, isRevoked: false }, data: { isRevoked: true } });
  });

  return NextResponse.json({ ok: true });
}
