/**
 * Authoritative match timing values. Persisted deadlines are always calculated
 * from these server-side values; clients render the persisted timestamps and
 * never decide when a match actually expires.
 */
const positiveMs = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
};

export const MATCH_START_TIMEOUT_MS = positiveMs("DUELPLAY_START_TIMEOUT_MS", 2 * 60 * 1000);
export const MATCH_CONNECTION_TIMEOUT_MS = positiveMs("DUELPLAY_CONNECTION_TIMEOUT_MS", 10 * 60 * 1000);
export const MATCH_HEARTBEAT_TIMEOUT_MS = positiveMs("DUELPLAY_HEARTBEAT_TIMEOUT_MS", 60 * 1000);
export const MATCH_SERVER_START_TIMEOUT_MS = positiveMs("DUELPLAY_SERVER_START_TIMEOUT_MS", 2 * 60 * 1000);

export function deadlineFromNow(ms: number, now = Date.now()): Date {
  return new Date(now + ms);
}
