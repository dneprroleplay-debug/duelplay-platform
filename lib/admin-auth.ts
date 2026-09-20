import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getCurrentSession } from "@/lib/current-user";

export const ADMIN_AUTH_COOKIE = "duelplay_admin_auth";

function secret() {
  const value = process.env.DUELPLAY_ADMIN_AUTH_SECRET?.trim() ?? "";
  if (value.length < 32) throw new Error("ADMIN_AUTH_SECRET_MISSING");
  return value;
}

function signature(sessionId: string, userId: string) {
  return createHmac("sha256", secret()).update(`${sessionId}:${userId}`).digest("hex");
}

export function createAdminAuthValue(sessionId: string, userId: string) {
  return `${sessionId}.${signature(sessionId, userId)}`;
}

export function verifyAdminAuthValue(value: string | undefined, sessionId: string, userId: string) {
  if (!value) return false;
  const [candidateSessionId, candidateSignature] = value.split(".");
  if (candidateSessionId !== sessionId || !/^[0-9a-f]{64}$/i.test(candidateSignature ?? "")) return false;
  const expected = signature(sessionId, userId);
  const a = Buffer.from(candidateSignature, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function adminAuthCookieOptions() {
  return {
    name: ADMIN_AUTH_COOKIE,
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  };
}

export async function getCurrentAdminSession() {
  const session = await getCurrentSession();
  if (!session?.user) return null;
  const adminCookie = (await cookies()).get(ADMIN_AUTH_COOKIE)?.value;
  if (!verifyAdminAuthValue(adminCookie, session.id, session.user.id)) return null;
  return session;
}

export function newAdminInviteToken() {
  return randomBytes(32).toString("hex");
}

export const ADMIN_INVITE_PREFIX = "ADMIN_INVITE:";
