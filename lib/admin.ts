import { prisma } from "@/lib/prisma";
import { getCurrentAdminSession } from "@/lib/admin-auth";
import type { NextRequest } from "next/server";
import { getAuditContext } from "@/lib/request-meta";

export const ADMIN_LEVELS = {
  SUPPORT: 1,
  MODERATOR: 2,
  ADMIN: 3,
  SUPERADMIN: 5,
} as const;

export const ADMIN_MFA_MAX_AGE_MS = 8 * 60 * 60 * 1000;

export function adminLevel(role: string) {
  return ADMIN_LEVELS[role as keyof typeof ADMIN_LEVELS] ?? 0;
}

export function isAdminMfaFresh(verifiedAt: Date | null | undefined) {
  return Boolean(verifiedAt && Date.now() - verifiedAt.getTime() <= ADMIN_MFA_MAX_AGE_MS);
}

export async function requireAdmin(minLevel = 1) {
  const session = await getCurrentAdminSession();
  const user = session?.user;
  if (!user || adminLevel(user.role) < minLevel) throw new Error("FORBIDDEN");
  if (!user.twoFactorEnabled) throw new Error("ADMIN_MFA_SETUP_REQUIRED");
  if (!isAdminMfaFresh(session?.adminMfaVerifiedAt)) throw new Error("ADMIN_MFA_REQUIRED");
  return user;
}

export async function audit(
  userId: string,
  action: string,
  targetType: string,
  targetId?: string,
  payload?: unknown,
  context?: { ipAddress?: string; userAgent?: string; requestId?: string; result?: string; reason?: string | null },
) {
  return prisma.auditLog.create({
    data: {
      userId,
      action,
      targetType,
      targetId: targetId || null,
      ipAddress: context?.ipAddress || "application",
      userAgent: context?.userAgent || "DuelPlay admin",
      requestId: context?.requestId || null,
      result: context?.result || "SUCCESS",
      reason: context?.reason || null,
      payload: payload as any,
    },
  });
}

export async function auditRequest(
  request: NextRequest,
  userId: string,
  action: string,
  targetType: string,
  targetId?: string,
  payload?: unknown,
  result = "SUCCESS",
  reason?: string | null,
) {
  return audit(userId, action, targetType, targetId, payload, {
    ...getAuditContext(request),
    result,
    reason,
  });
}
