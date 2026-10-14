import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { hasAdminLevel } from "@/lib/role-policy";
import type { Prisma } from "@prisma/client";

export const MAINTENANCE_MESSAGE = "Идёт обновление серверов CS2. Пожалуйста, подождите";

const MATCH_MAINTENANCE_LOCK = "duelplay:maintenance-match-ops";

export async function assertMatchmakingAvailable(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${MATCH_MAINTENANCE_LOCK}))`;
  const maintenance = await tx.featureFlag.findUnique({ where: { key: "MAINTENANCE_MODE" } });
  if (maintenance?.enabled) throw new Error("CS2_MAINTENANCE");
}

export async function lockMaintenanceChanges(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${MATCH_MAINTENANCE_LOCK}))`;
}

export async function getMaintenanceState() {
  const row = await prisma.featureFlag.findUnique({ where: { key: "MAINTENANCE_MODE" } });
  return { enabled: row?.enabled ?? false, message: MAINTENANCE_MESSAGE };
}

export async function canBypassMaintenance() {
  const me = await getCurrentUser();
  return Boolean(me && hasAdminLevel(me.role, 1));
}

export async function assertMaintenanceAccess() {
  const state = await getMaintenanceState();
  if (!state.enabled) return { allowed: true as const, state };
  const bypass = await canBypassMaintenance();
  return { allowed: bypass, state };
}
