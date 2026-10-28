import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashCode } from "@/lib/email";
import { enforceIpRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-meta";
import { isSameOriginRequest } from "@/lib/steam-link-security";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request.headers.get("origin"), new URL(request.url).origin)) return NextResponse.json({ error: "CROSS_ORIGIN_REQUEST" }, { status: 403 });
  const ip = getClientIp(request);
  try {
    await prisma.$transaction((tx) => enforceIpRateLimit(tx, ip, "EMAIL_LINK_VERIFY", 10, 10 * 60_000));
  } catch (error) {
    if (error instanceof Error && error.message === "RATE_LIMITED") return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    throw error;
  }
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const token = String(body.token ?? "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(token)) return NextResponse.json({ error: "TOKEN_INVALID" }, { status: 400 });
  const tokenHash = hashCode(token);
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`email-link:${tokenHash}`}, 0))`;
      const record = await tx.emailVerificationCode.findFirst({ where: { purpose: "EMAIL_LINK", codeHash: tokenHash, usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
      if (!record?.userId) throw new Error("TOKEN_INVALID_OR_EXPIRED");
      const user = await tx.user.findUnique({ where: { id: record.userId }, select: { id: true, status: true, deletedAt: true, email: true } });
      if (!user || user.status !== "ACTIVE" || user.deletedAt) throw new Error("ACCOUNT_DISABLED");
      const email = record.email.trim().toLowerCase();
      const owner = await tx.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } });
      if (owner && owner.id !== user.id) throw new Error("EMAIL_CONFLICT");
      const consumed = await tx.emailVerificationCode.updateMany({ where: { id: record.id, userId: user.id, purpose: "EMAIL_LINK", codeHash: tokenHash, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
      if (consumed.count !== 1) throw new Error("TOKEN_INVALID_OR_EXPIRED");
      await tx.user.update({ where: { id: user.id }, data: { email, emailVerifiedAt: new Date() } });
      await tx.securityEvent.create({ data: { userId: user.id, eventType: "EMAIL_LINK_COMPLETED", severity: "INFO", ipAddress: ip, metadata: { emailDomain: email.split("@")[1] ?? "" } } });
      return { email };
    }, { isolationLevel: "Serializable" });
    return NextResponse.json({ ok: true, email: result.email });
  } catch (error) {
    if (error instanceof Error && error.message === "EMAIL_CONFLICT") return NextResponse.json({ error: "EMAIL_UNAVAILABLE" }, { status: 409 });
    if (error instanceof Error && error.message === "TOKEN_INVALID_OR_EXPIRED") return NextResponse.json({ error: "TOKEN_INVALID_OR_EXPIRED" }, { status: 400 });
    if (error instanceof Error && error.message === "ACCOUNT_DISABLED") return NextResponse.json({ error: "ACCOUNT_DISABLED" }, { status: 403 });
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") return NextResponse.json({ error: "EMAIL_UNAVAILABLE" }, { status: 409 });
    throw error;
  }
}
