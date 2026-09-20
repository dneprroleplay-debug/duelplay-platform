import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { hashToken, SESSION_COOKIE } from "@/lib/auth";

export async function getCurrentSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const tokenHash = hashToken(token);
  const session = await prisma.userSession.findFirst({
    where: { token: tokenHash, isRevoked: false, expiresAt: { gt: new Date() } },
    include: { user: { include: { wallet: true } } },
  });
  return session ?? null;
}

export async function getCurrentUser() {
  const session = await getCurrentSession();
  return session?.user ?? null;
}
