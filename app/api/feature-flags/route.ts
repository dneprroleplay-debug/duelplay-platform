import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, audit } from "@/lib/admin";
import { FEATURE_FLAG_DEFAULTS, FEATURE_FLAG_KEYS, validateFeatureFlagPayload } from "@/lib/feature-flags";

export async function GET() {
  try {
    await requireAdmin(5);
    const rows = await prisma.featureFlag.findMany({ where: { key: { in: [...FEATURE_FLAG_KEYS] } }, orderBy: { key: "asc" } });
    const byKey = new Map(rows.map(row => [row.key, row]));
    return NextResponse.json(FEATURE_FLAG_KEYS.map(key => byKey.get(key) ?? { key, enabled: FEATURE_FLAG_DEFAULTS[key], updatedBy: null, updatedAt: null }));
  } catch { return NextResponse.json({ error: "SUPERADMIN required" }, { status: 403 }); }
}
export async function PATCH(r: NextRequest) {
  try {
    const me = await requireAdmin(5);
    const validation = validateFeatureFlagPayload(await r.json().catch(() => null));
    if (!validation.ok) return NextResponse.json({ error: "Invalid feature flag payload", errorCode: validation.error }, { status: 400 });
    const row = await prisma.featureFlag.upsert({ where: { key: validation.key }, update: { enabled: validation.enabled, updatedBy: me.id }, create: { key: validation.key, enabled: validation.enabled, updatedBy: me.id } });
    await audit(me.id, "CHANGE_FEATURE_FLAG", "FEATURE_FLAG", row.id, { key: validation.key, enabled: validation.enabled });
    return NextResponse.json(row);
  } catch { return NextResponse.json({ error: "SUPERADMIN required" }, { status: 403 }); }
}
