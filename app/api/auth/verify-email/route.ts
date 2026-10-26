import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashCode } from "@/lib/email";
import { enforceIpRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-meta";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  try {
    await prisma.$transaction((tx) => enforceIpRateLimit(tx, ip, "VERIFY_EMAIL", 20, 10 * 60_000));
  } catch (e) {
    if (e instanceof Error && e.message === "RATE_LIMITED") return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    throw e;
  }

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const email = String(body.email || "").trim().toLowerCase();
  const code = String(body.code || "").trim().toUpperCase();

  const record = await prisma.emailVerificationCode.findFirst({
    where: { email, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!record) return NextResponse.json({ error: "Code expired or not found" }, { status: 400 });

  if (record.attempts >= 5) return NextResponse.json({ error: "Too many attempts" }, { status: 429 });

  await prisma.emailVerificationCode.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });

  if (hashCode(code) !== record.codeHash) {
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.emailVerificationCode.update({ where: { id: record.id }, data: { usedAt: new Date() } });
    if (record.userId) {
      await tx.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } });
    } else {
      await tx.user.updateMany({ where: { email }, data: { emailVerifiedAt: new Date() } });
    }
  });

  return NextResponse.json({ ok: true });
}
