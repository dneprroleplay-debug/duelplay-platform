import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { enforceIpRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-meta";
import { auditRequest } from "@/lib/admin";
import { requirePermission, resolveAdminAccess } from "@/lib/admin-rbac";
import { MAINTENANCE_MESSAGE } from "@/lib/maintenance";

export async function GET() {
  const row = await prisma.featureFlag.findUnique({ where: { key: "MAINTENANCE_MODE" } });
  const me = await getCurrentUser();
  const access = me ? await resolveAdminAccess(me.id) : null;
  return NextResponse.json({
    enabled: row?.enabled ?? false,
    message: MAINTENANCE_MESSAGE,
    isAdmin: Boolean(access && access.level > 0),
  }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
}

export async function PATCH(request: NextRequest) {
  const ip = getClientIp(request);
  await prisma.$transaction(tx => enforceIpRateLimit(tx, ip, "MAINTENANCE_ACTION", 20, 10 * 60_000));
  let me: Awaited<ReturnType<typeof requirePermission>>;
  try {
    me = await requirePermission("system.maintenance");
  } catch (error) {
    if (error instanceof Error && error.message === "ADMIN_MFA_SETUP_REQUIRED") return NextResponse.json({ error: "Требуется настроить MFA", errorCode: error.message }, { status: 403 });
    if (error instanceof Error && error.message === "ADMIN_MFA_REQUIRED") return NextResponse.json({ error: "Требуется подтверждение MFA", errorCode: error.message }, { status: 403 });
    return NextResponse.json({ error: "Permission system.maintenance required" }, { status: 403 });
  }

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 }); }
  if (!body || typeof body !== "object" || typeof (body as Record<string, unknown>).enabled !== "boolean") {
    return NextResponse.json({ error: "INVALID_ENABLED" }, { status: 400 });
  }
  const enabled = (body as Record<string, unknown>).enabled as boolean;

  const row = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('duelplay:maintenance-match-ops'))`;
    return tx.featureFlag.upsert({
      where: { key: "MAINTENANCE_MODE" },
      update: { enabled, updatedBy: me.user.id },
      create: { key: "MAINTENANCE_MODE", enabled, updatedBy: me.user.id },
    });
  });
  await auditRequest(request, me.user.id, enabled ? "ENABLE_MAINTENANCE" : "DISABLE_MAINTENANCE", "PLATFORM", row.id, { enabled, result: "SUCCESS" });
  return NextResponse.json(row, { headers: { "Cache-Control": "no-store" } });
}
