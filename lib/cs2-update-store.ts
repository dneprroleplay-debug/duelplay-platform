import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CS2_UPDATE_TIME_ZONE, DEFAULT_CS2_UPDATE_TIME, normalizeCs2UpdateSchedule, type Cs2UpdateSchedule } from "@/lib/cs2-update-schedule.mjs";

export const CS2_UPDATE_SCHEDULE_KEY = "CS2_AUTO_UPDATE_SCHEDULE";
export const CS2_UPDATE_SCHEDULE_LOCK = "duelplay:cs2-auto-update-schedule";

export type ScheduleStoreClient = typeof prisma | Prisma.TransactionClient;

export type ScheduleReadResult = {
  schedule: Cs2UpdateSchedule | null;
  configured: boolean;
  invalid: boolean;
};

export async function readCs2UpdateSchedule(db: ScheduleStoreClient = prisma): Promise<ScheduleReadResult> {
  const row = await db.siteSettings.findUnique({ where: { key: CS2_UPDATE_SCHEDULE_KEY }, select: { value: true } });
  if (!row) {
    return {
      configured: false,
      invalid: false,
      schedule: normalizeCs2UpdateSchedule({
        enabled: false,
        localTime: DEFAULT_CS2_UPDATE_TIME,
        timeZone: CS2_UPDATE_TIME_ZONE,
        revision: 0,
        scheduleChangedAt: null,
        lastCheckedAt: null,
        agentStatus: "UNKNOWN",
        agentError: null,
      }),
    };
  }
  const schedule = normalizeCs2UpdateSchedule(row.value);
  return { schedule, configured: true, invalid: !schedule };
}

export function sanitizeUpdateDiagnostic(value: unknown, maxLength = 1000): string | null {
  if (typeof value !== "string") return null;
  return value
    .replace(/(DUELPLAY_SERVER_MANAGER_SECRET|CS2_RESULT_SECRET|CS2_GSI_TOKEN|STEAMCMD_PASSWORD)\s*[=:]\s*[^\s,;]+/gi, "$1=<redacted>")
    .replace(/(?:Bearer\s+)[A-Za-z0-9._~-]+/gi, "Bearer <redacted>")
    .slice(0, maxLength);
}
