import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { hasAdminLevel } from "@/lib/role-policy";

export const MAINTENANCE_MESSAGE = "DuelPlay is temporarily under maintenance. Please try again soon.";

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
