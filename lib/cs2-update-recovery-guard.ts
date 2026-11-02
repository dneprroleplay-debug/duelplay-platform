import type { Prisma } from "@prisma/client";

const RECOVERY_KEY_PREFIX = "CS2_UPDATE_RECOVERY_V1_";
const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isValidCompletedRecoveryRow(key: string, value: unknown): boolean {
  if (!key.startsWith(RECOVERY_KEY_PREFIX) || !isRecord(value)) return false;
  const runId = key.slice(RECOVERY_KEY_PREFIX.length);
  if (!RUN_ID_PATTERN.test(runId) || runId !== runId.toLowerCase()) return false;

  const startedAt = typeof value.startedAt === "string" ? Date.parse(value.startedAt) : Number.NaN;
  const updatedAt = typeof value.updatedAt === "string" ? Date.parse(value.updatedAt) : Number.NaN;
  return value.version === 1
    && value.runId === runId
    && value.recoveryId === `cs2-update-recovery-v1:${runId}`
    && value.phase === "COMPLETED"
    && Number.isFinite(startedAt)
    && Number.isFinite(updatedAt)
    && updatedAt >= startedAt
    && Number.isSafeInteger(value.markerPid)
    && Number(value.markerPid) > 0
    && typeof value.markerMtimeMs === "number"
    && Number.isFinite(value.markerMtimeMs);
}

/**
 * Returns every recovery journal that is not a valid, completed v1 journal.
 * Malformed, partially persisted, or future-version rows deliberately fail closed:
 * their presence blocks MAINTENANCE_MODE=false until repaired by a reviewed process.
 * Call inside the same transaction that would mutate updater/maintenance control and
 * while holding `duelplay:maintenance-match-ops` advisory lock.
 */
export async function getUnfinishedCs2RecoveryKeys(tx: Prisma.TransactionClient): Promise<string[]> {
  const rows = await tx.siteSettings.findMany({
    where: { key: { startsWith: RECOVERY_KEY_PREFIX } },
    select: { key: true, value: true },
  });
  return rows
    .filter(row => !isValidCompletedRecoveryRow(row.key, row.value))
    .map(row => row.key);
}
