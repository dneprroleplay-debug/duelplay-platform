import { prisma } from "@/lib/prisma";
import { getFeatureFlag } from "@/lib/feature-flags";
export { getFeatureFlag };
export async function getPlatformNumber(key: string, fallback: number) {
  const row = await prisma.platformSetting.findUnique({ where: { key } });
  return row ? Number(row.value) : fallback;
}
