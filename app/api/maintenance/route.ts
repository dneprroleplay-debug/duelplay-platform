import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { hasAdminLevel } from "@/lib/role-policy";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/admin";
import { MAINTENANCE_MESSAGE } from "@/lib/maintenance";

export async function GET() {
  const row = await prisma.featureFlag.findUnique({ where: { key: "MAINTENANCE_MODE" } });
  const me = await getCurrentUser();
  return NextResponse.json({
    enabled: row?.enabled ?? false,
    message: MAINTENANCE_MESSAGE,
    isAdmin: Boolean(me && hasAdminLevel(me.role, 1)),
  }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
}

export async function PATCH(request: Request) {
  const me = await getCurrentUser();
  if (!me || me.role !== "SUPERADMIN") return NextResponse.json({ error: "SUPERADMIN required" }, { status: 403 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 }); }
  if (!body || typeof body !== "object" || typeof (body as Record<string, unknown>).enabled !== "boolean") {
    return NextResponse.json({ error: "INVALID_ENABLED" }, { status: 400 });
  }
  const enabled = (body as Record<string, unknown>).enabled as boolean;

  const row = await prisma.featureFlag.upsert({
    where: { key: "MAINTENANCE_MODE" },
    update: { enabled, updatedBy: me.id },
    create: { key: "MAINTENANCE_MODE", enabled, updatedBy: me.id },
  });
  await audit(me.id, enabled ? "ENABLE_MAINTENANCE" : "DISABLE_MAINTENANCE", "PLATFORM", row.id, { enabled });
  return NextResponse.json(row, { headers: { "Cache-Control": "no-store" } });
}
