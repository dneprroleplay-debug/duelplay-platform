import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, audit } from "@/lib/admin";
import { isPlatformSettingKey, PLATFORM_SETTING_RULES, validatePlatformSettingRelationships, validatePlatformSettingValue } from "@/lib/platform-setting-policy";

export async function GET() {
  await requireAdmin(5);
  const rows = await prisma.platformSetting.findMany({ orderBy: { key: "asc" } });
  return NextResponse.json(rows.map((row) => ({ ...row, value: Number(row.value), minValue: row.minValue == null ? null : Number(row.minValue), maxValue: row.maxValue == null ? null : Number(row.maxValue), step: row.step == null ? null : Number(row.step) })));
}

export async function PATCH(request: NextRequest) {
  const me = await requireAdmin(5);
  const body = await request.json().catch(() => ({}));
  const key = String(body.key ?? "");
  const validation = validatePlatformSettingValue(key, body.value);
  if (!validation.ok) return NextResponse.json({ error: "Invalid setting", errorCode: validation.error }, { status: 400 });

  const current = await prisma.platformSetting.findMany({ where: { key: { in: ["MIN_STAKE", "MAX_STAKE"] } } });
  const values: Record<string, number> = Object.fromEntries(current.map((row) => [row.key, Number(row.value)]));
  values[key] = validation.value;
  if (key === "MIN_STAKE" || key === "MAX_STAKE") {
    const relation = validatePlatformSettingRelationships(values);
    if (!relation.ok) return NextResponse.json({ error: "MIN_STAKE cannot exceed MAX_STAKE", errorCode: relation.error }, { status: 400 });
  }

  const rule = PLATFORM_SETTING_RULES[key as keyof typeof PLATFORM_SETTING_RULES];
  const old = await prisma.platformSetting.findUnique({ where: { key } });
  const row = await prisma.platformSetting.upsert({
    where: { key },
    update: { value: validation.value, minValue: rule.min, maxValue: rule.max, step: rule.step, updatedBy: me.id },
    create: { key, value: validation.value, minValue: rule.min, maxValue: rule.max, step: rule.step, updatedBy: me.id },
  });
  await audit(me.id, "CHANGE_PLATFORM_SETTING", "PLATFORM_SETTING", row.id, { key, old: old?.value?.toString() ?? null, new: validation.value });
  return NextResponse.json(row);
}
