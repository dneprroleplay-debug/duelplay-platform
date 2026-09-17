import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE } from "@/lib/auth";
export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token) await prisma.userSession.updateMany({ where: { token }, data: { isRevoked: true } });
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
