export const CS2_UPDATE_TIME_ZONE = 'Europe/Kyiv';
export const DEFAULT_CS2_UPDATE_TIME = '05:00';

const formatterCache = new Map();

function formatterFor(timeZone) {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function zonedParts(date, timeZone) {
  const fields = Object.fromEntries(formatterFor(timeZone).formatToParts(date).map(part => [part.type, part.value]));
  const year = Number(fields.year);
  const month = Number(fields.month);
  const day = Number(fields.day);
  const hour = Number(fields.hour);
  const minute = Number(fields.minute);
  return {
    year,
    month,
    day,
    hour,
    minute,
    date: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  };
}

function validDateParts(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split('-').map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

export function isValidCs2UpdateTime(value) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return false;
  return true;
}

export function normalizeCs2UpdateSchedule(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value;
  if (typeof candidate.enabled !== 'boolean' || !isValidCs2UpdateTime(candidate.localTime)) return null;
  if (candidate.timeZone !== undefined && candidate.timeZone !== CS2_UPDATE_TIME_ZONE) return null;
  const revision = Number(candidate.revision ?? 0);
  if (!Number.isInteger(revision) || revision < 0) return null;
  const changedAt = candidate.scheduleChangedAt == null ? null : new Date(String(candidate.scheduleChangedAt));
  if (changedAt && !Number.isFinite(changedAt.getTime())) return null;
  return {
    enabled: candidate.enabled,
    localTime: candidate.localTime,
    timeZone: CS2_UPDATE_TIME_ZONE,
    revision,
    scheduleChangedAt: changedAt?.toISOString() ?? null,
    lastCheckedAt: typeof candidate.lastCheckedAt === 'string' ? candidate.lastCheckedAt : null,
    agentStatus: typeof candidate.agentStatus === 'string' ? candidate.agentStatus : 'UNKNOWN',
    agentError: typeof candidate.agentError === 'string' ? candidate.agentError.slice(0, 1000) : null,
  };
}

export function resolveLocalMinuteInstants(localDate, localTime, timeZone = CS2_UPDATE_TIME_ZONE) {
  const dateParts = validDateParts(localDate);
  if (!dateParts || !isValidCs2UpdateTime(localTime)) return [];
  const [hour, minute] = localTime.split(':').map(Number);
  const wallClockAsUtc = Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, hour, minute);
  const offsets = new Set();

  // Sampling around the wall-clock date finds both offsets in a DST fold and
  // correctly returns no instant for a local minute skipped by a DST jump.
  for (const deltaHours of [-36, -24, -12, 0, 12, 24, 36]) {
    const sample = wallClockAsUtc + deltaHours * 60 * 60_000;
    const parts = zonedParts(new Date(sample), timeZone);
    const roundedUtcMinute = Math.floor(sample / 60_000) * 60_000;
    offsets.add(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - roundedUtcMinute);
  }

  const candidates = new Set();
  for (const offset of offsets) {
    const instant = wallClockAsUtc - offset;
    const parts = zonedParts(new Date(instant), timeZone);
    if (parts.date === localDate && parts.time === localTime) candidates.add(instant);
  }
  return [...candidates].sort((left, right) => left - right).map(value => new Date(value));
}

function addLocalDays(localDate, amount) {
  const parts = validDateParts(localDate);
  if (!parts) return null;
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + amount));
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function getNextCs2UpdateAt(schedule, now = new Date()) {
  const normalized = normalizeCs2UpdateSchedule(schedule);
  if (!normalized?.enabled) return null;
  const currentLocalDate = zonedParts(now, normalized.timeZone).date;
  for (let dayOffset = 0; dayOffset <= 3; dayOffset += 1) {
    const localDate = addLocalDays(currentLocalDate, dayOffset);
    if (!localDate) return null;
    for (const instant of resolveLocalMinuteInstants(localDate, normalized.localTime, normalized.timeZone)) {
      if (instant.getTime() > now.getTime()) return instant.toISOString();
    }
  }
  return null;
}

export function getDueCs2UpdateOccurrence(schedule, now = new Date()) {
  const normalized = normalizeCs2UpdateSchedule(schedule);
  if (!normalized?.enabled) return null;
  const local = zonedParts(now, normalized.timeZone);
  if (local.time !== normalized.localTime) return null;
  const currentMinute = Math.floor(now.getTime() / 60_000) * 60_000;
  const occurrence = resolveLocalMinuteInstants(local.date, normalized.localTime, normalized.timeZone)
    .find(candidate => Math.floor(candidate.getTime() / 60_000) * 60_000 === currentMinute);
  if (!occurrence) return null;
  if (normalized.scheduleChangedAt && new Date(normalized.scheduleChangedAt).getTime() >= occurrence.getTime()) return null;
  return { localDate: local.date, localTime: normalized.localTime, timeZone: normalized.timeZone, scheduledAt: occurrence.toISOString(), revision: normalized.revision };
}

export function decideCs2UpdateClaim(schedule, now = new Date(), existingRun = null) {
  const occurrence = getDueCs2UpdateOccurrence(schedule, now);
  if (!occurrence) return { claim: false, reason: 'NOT_DUE', occurrence: null };
  if (existingRun) return { claim: false, reason: 'ALREADY_CLAIMED_TODAY', occurrence, existingRun };
  return { claim: true, reason: 'DUE', occurrence };
}

export function buildCs2ScheduleAuditPayload(before, after) {
  const pick = value => value ? {
    enabled: value.enabled,
    localTime: value.localTime,
    timeZone: CS2_UPDATE_TIME_ZONE,
    revision: value.revision,
  } : null;
  return { before: pick(before), after: pick(after) };
}
