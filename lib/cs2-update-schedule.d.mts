export const CS2_UPDATE_TIME_ZONE: "Europe/Kyiv";
export const DEFAULT_CS2_UPDATE_TIME: "05:00";

export type Cs2UpdateSchedule = {
  enabled: boolean;
  localTime: string;
  timeZone: "Europe/Kyiv";
  revision: number;
  scheduleChangedAt: string | null;
  lastCheckedAt: string | null;
  agentStatus: string;
  agentError: string | null;
};

export function isValidCs2UpdateTime(value: unknown): value is string;
export function normalizeCs2UpdateSchedule(value: unknown): Cs2UpdateSchedule | null;
export function resolveLocalMinuteInstants(localDate: string, localTime: string, timeZone?: string): Date[];
export function getNextCs2UpdateAt(schedule: unknown, now?: Date): string | null;
export function getDueCs2UpdateOccurrence(schedule: unknown, now?: Date): {
  localDate: string;
  localTime: string;
  timeZone: "Europe/Kyiv";
  scheduledAt: string;
  revision: number;
} | null;
export function decideCs2UpdateClaim(schedule: unknown, now?: Date, existingRun?: unknown): {
  claim: boolean;
  reason: "NOT_DUE" | "ALREADY_CLAIMED_TODAY" | "DUE";
  occurrence: ReturnType<typeof getDueCs2UpdateOccurrence>;
  existingRun?: unknown;
};
export function buildCs2ScheduleAuditPayload(before: unknown, after: unknown): { before: Record<string, unknown> | null; after: Record<string, unknown> | null };
