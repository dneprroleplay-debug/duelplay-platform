import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeNickname, validateNickname } from "@/lib/nickname";

export async function GET(request: NextRequest) {
  const nickname = request.nextUrl.searchParams.get("nickname")?.trim() ?? "";
  if (!validateNickname(nickname)) {
    return NextResponse.json({ available: false, reason: "invalid" });
  }
  const normalized = normalizeNickname(nickname);
  const existing = await prisma.user.findFirst({ where: { nicknameNormalized: normalized } });
  if (existing) return NextResponse.json({ available: false, reason: "taken" });
  // fallback case-insensitive
  const existing2 = await prisma.user.findFirst({ where: { nickname: { equals: nickname, mode: "insensitive" } } });
  if (existing2) return NextResponse.json({ available: false, reason: "taken" });
  return NextResponse.json({ available: true });
}
