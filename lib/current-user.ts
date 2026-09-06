import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE } from "@/lib/auth";
export async function getCurrentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.userSession.findFirst({ where: { token, isRevoked: false, expiresAt: { gt: new Date() } }, include: { user: { include: { wallet: true } } } });
  return session?.user ?? null;
}
