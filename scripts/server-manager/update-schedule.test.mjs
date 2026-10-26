import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CS2_UPDATE_TIME_ZONE,
  DEFAULT_CS2_UPDATE_TIME,
  buildCs2ScheduleAuditPayload,
  decideCs2UpdateClaim,
  getDueCs2UpdateOccurrence,
  getNextCs2UpdateAt,
  normalizeCs2UpdateSchedule,
  resolveLocalMinuteInstants,
} from '../../lib/cs2-update-schedule.mjs';
import { canManageCs2AutoUpdates } from '../../lib/cs2-update-access.mjs';
import { createServerManagerRequestHeaders, verifyServerManagerRequestSignature } from '../../lib/server-manager-request-signature.mjs';
import { createUpdateScheduleClient } from './update-schedule-client.mjs';

const SECRET = 'test-only-secret-that-is-long-enough-for-signed-requests';
const enabledSchedule = {
  enabled: true,
  localTime: DEFAULT_CS2_UPDATE_TIME,
  timeZone: CS2_UPDATE_TIME_ZONE,
  revision: 2,
  scheduleChangedAt: '2026-10-25T00:00:00.000Z',
};

test('normalizes only 24-hour schedule values in the fixed Kyiv timezone', () => {
  assert.equal(normalizeCs2UpdateSchedule({ ...enabledSchedule, localTime: '24:00' }), null);
  assert.equal(normalizeCs2UpdateSchedule({ ...enabledSchedule, localTime: '5:00' }), null);
  assert.equal(normalizeCs2UpdateSchedule({ ...enabledSchedule, timeZone: 'UTC' }), null);
  assert.equal(normalizeCs2UpdateSchedule(enabledSchedule)?.timeZone, 'Europe/Kyiv');
});

test('computes the next run using Europe/Kyiv wall time after the autumn offset change', () => {
  const next = getNextCs2UpdateAt(enabledSchedule, new Date('2026-10-26T02:00:00.000Z'));
  assert.equal(next, '2026-10-26T03:00:00.000Z');
});

test('claims only the configured minute and not immediately after an admin save at that minute', () => {
  const dueNow = getDueCs2UpdateOccurrence(enabledSchedule, new Date('2026-10-26T03:00:20.000Z'));
  assert.equal(dueNow?.localDate, '2026-10-26');
  assert.equal(dueNow?.scheduledAt, '2026-10-26T03:00:00.000Z');
  assert.equal(getDueCs2UpdateOccurrence({ ...enabledSchedule, scheduleChangedAt: '2026-10-26T03:00:01.000Z' }, new Date('2026-10-26T03:00:20.000Z')), null);
  assert.equal(getDueCs2UpdateOccurrence({ ...enabledSchedule, enabled: false }, new Date('2026-10-26T03:00:20.000Z')), null);
});

test('does not claim a second run for a local date already represented in history', () => {
  const now = new Date('2026-10-26T03:00:20.000Z');
  assert.equal(decideCs2UpdateClaim(enabledSchedule, now, null).claim, true);
  assert.equal(decideCs2UpdateClaim(enabledSchedule, now, { id: 'already-run' }).reason, 'ALREADY_CLAIMED_TODAY');
  assert.equal(decideCs2UpdateClaim(enabledSchedule, new Date('2026-10-26T03:01:01.000Z'), null).reason, 'NOT_DUE');
});

test('handles Kyiv daylight-saving gaps and repeated local minutes', () => {
  assert.deepEqual(resolveLocalMinuteInstants('2026-03-29', '03:30', 'Europe/Kyiv'), []);
  const repeated = resolveLocalMinuteInstants('2026-10-25', '03:30', 'Europe/Kyiv');
  assert.equal(repeated.length, 2);
  assert.equal(getNextCs2UpdateAt({ ...enabledSchedule, localTime: '03:30' }, new Date('2026-10-25T00:00:00.000Z')), repeated[0].toISOString());
});

test('CS2 schedule admin access is limited to SUPERADMIN or existing level 999', () => {
  assert.equal(canManageCs2AutoUpdates({ roleCode: 'SUPERADMIN', level: 1 }), true);
  assert.equal(canManageCs2AutoUpdates({ roleCode: 'FOUNDER', level: 999 }), true);
  assert.equal(canManageCs2AutoUpdates({ roleCode: 'TECH_ADMIN', level: 7 }), false);
  assert.equal(canManageCs2AutoUpdates({ roleCode: 'ADMIN', level: 3 }), false);
  assert.equal(canManageCs2AutoUpdates(null), false);
});

test('schedule audit records old and new enabled/time values without unrelated fields', () => {
  assert.deepEqual(buildCs2ScheduleAuditPayload(
    { enabled: false, localTime: '05:00', revision: 3, agentError: 'private internal diagnostic' },
    { enabled: true, localTime: '04:30', revision: 4 },
  ), {
    before: { enabled: false, localTime: '05:00', timeZone: 'Europe/Kyiv', revision: 3 },
    after: { enabled: true, localTime: '04:30', timeZone: 'Europe/Kyiv', revision: 4 },
  });
});

test('fresh server-manager request signature binds method, path, body and expires', () => {
  const now = Date.parse('2026-10-26T03:00:00.000Z');
  const path = '/api/server-manager/update-schedule/claim';
  const body = JSON.stringify({ localDate: '2026-10-26', revision: 2 });
  const headers = createServerManagerRequestHeaders({ secret: SECRET, method: 'POST', path, body, now, nonce: '0123456789abcdef0123456789abcdef' });
  const check = override => verifyServerManagerRequestSignature({
    secret: SECRET,
    timestamp: headers['x-duelplay-request-timestamp'],
    nonce: headers['x-duelplay-request-nonce'],
    signature: headers['x-duelplay-request-signature'],
    method: 'POST',
    path,
    body,
    now,
    ...override,
  });
  assert.equal(check(), true);
  assert.equal(check({ now: now + 120_000 }), false);
  assert.equal(check({ path: `${path}?other=1` }), false);
  assert.equal(check({ body: `${body} ` }), false);
  assert.equal(check({ secret: `${SECRET}wrong` }), false);
});

test('schedule API client signs requests without placing its secret in the URL', async () => {
  let seen;
  const now = Date.parse('2026-10-26T03:00:00.000Z');
  const client = createUpdateScheduleClient({
    apiUrl: 'https://duelplay.test/',
    secret: SECRET,
    now: () => now,
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const body = { enabled: false, localTime: '05:00' };
  assert.deepEqual(await client('/api/server-manager/update-schedule', { method: 'POST', body }), { ok: true });
  assert.equal(seen.url, 'https://duelplay.test/api/server-manager/update-schedule');
  assert.equal(String(seen.init.body), JSON.stringify(body));
  assert.equal(seen.init.headers['x-duelplay-server-secret'], SECRET);
  assert.equal(verifyServerManagerRequestSignature({
    secret: SECRET,
    timestamp: seen.init.headers['x-duelplay-request-timestamp'],
    nonce: seen.init.headers['x-duelplay-request-nonce'],
    signature: seen.init.headers['x-duelplay-request-signature'],
    method: 'POST',
    path: '/api/server-manager/update-schedule',
    body: JSON.stringify(body),
    now,
  }), true);
});
