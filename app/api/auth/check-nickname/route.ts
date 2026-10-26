import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeNickname, validateNickname } from "@/lib/nickname";
import { enforceIpRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-meta";

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  try {
    await prisma.$transaction((tx) => enforceIpRateLimit(tx, ip, "CHECK_NICKNAME", 30, 10 * 60_000));
  } catch (e) {
    if (e instanceof Error && e.message === "RATE_LIMITED") return NextResponse.json({ available: false, reason: "rate_limited" }, { status: 429 });
    throw e;
  }
  const nickname = request.nextUrl.searchParams.get("nickname")?.trim() ?? "";
  if (!validateNickname(nickname)) {
    return NextResponse.json({ available: false, reason: "invalid" });
  }
  const normalized = normalizeNickname(nickname);
  const existing = await prisma.user.findFirst({ where: { OR: [{ nicknameNormalized: normalized }, { nickname: { equals: nickname, mode: "insensitive" } }] } });
  if (existing) return NextResponse.json({ available: false, reason: "taken" });
  return NextResponse.json({ available: true });
}
