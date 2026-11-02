import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/admin";
import { requirePermission } from "@/lib/admin-rbac";
import { FEATURE_FLAG_DEFAULTS, FEATURE_FLAG_KEYS, validateFeatureFlagPayload } from "@/lib/feature-flags";
import { getUnfinishedCs2RecoveryKeys } from "@/lib/cs2-update-recovery-guard";

export async function GET() {
  try {
    await requirePermission("feature_flags.manage");
    const rows = await prisma.featureFlag.findMany({ where: { key: { in: [...FEATURE_FLAG_KEYS] } }, orderBy: { key: "asc" } });
    const byKey = new Map(rows.map(row => [row.key, row]));
    return NextResponse.json(FEATURE_FLAG_KEYS.map(key => byKey.get(key) ?? { key, enabled: FEATURE_FLAG_DEFAULTS[key], updatedBy: null, updatedAt: null }));
  } catch { return NextResponse.json({ error: "SUPERADMIN required" }, { status: 403 }); }
}
export async function PATCH(r: NextRequest) {
  try {
    const me = await requirePermission("feature_flags.manage");
    const validation = validateFeatureFlagPayload(await r.json().catch(() => null));
    if (!validation.ok) return NextResponse.json({ error: "Invalid feature flag payload", errorCode: validation.error }, { status: 400 });
    let blockedRecoveryKeys: string[] = [];
    let row: Awaited<ReturnType<typeof prisma.featureFlag.upsert>> | null = null;
    if (validation.key === "MAINTENANCE_MODE" && validation.enabled === false) {
      const result = await prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('duelplay:maintenance-match-ops'))`;
        const blocked = await getUnfinishedCs2RecoveryKeys(tx);
        if (blocked.length > 0) return { row: null, blockedRecoveryKeys: blocked };
        const updated = await tx.featureFlag.upsert({ where: { key: validation.key }, update: { enabled: validation.enabled, updatedBy: me.user.id }, create: { key: validation.key, enabled: validation.enabled, updatedBy: me.user.id } });
        return { row: updated, blockedRecoveryKeys: [] as string[] };
      });
      row = result.row;
      blockedRecoveryKeys = result.blockedRecoveryKeys;
    } else {
      row = await prisma.featureFlag.upsert({ where: { key: validation.key }, update: { enabled: validation.enabled, updatedBy: me.user.id }, create: { key: validation.key, enabled: validation.enabled, updatedBy: me.user.id } });
    }
    if (blockedRecoveryKeys.length > 0) {
      await audit(me.user.id, "BLOCK_DISABLE_MAINTENANCE_DURING_CS2_RECOVERY", "PLATFORM", blockedRecoveryKeys[0], { result: "BLOCKED", blockedRecoveryKeys });
      return NextResponse.json({ errorCode: "CS2_RECOVERY_IN_PROGRESS" }, { status: 409 });
    }
    await audit(me.user.id, "CHANGE_FEATURE_FLAG", "FEATURE_FLAG", row!.id, { key: validation.key, enabled: validation.enabled });
    return NextResponse.json(row);
  } catch { return NextResponse.json({ error: "SUPERADMIN required" }, { status: 403 }); }
}
