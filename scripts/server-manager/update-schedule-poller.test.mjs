import test from 'node:test';
import assert from 'node:assert/strict';
import { pollCs2UpdateSchedule } from '../../lib/cs2-update-poller.mjs';

async function runPoll(overrides = {}) {
  const calls = [];
  const deps = {
    readSchedule: async () => ({ schedule: { enabled: false, localTime: '05:00', revision: 1 }, due: null }),
    updateHeartbeat: async body => { calls.push(['heartbeat', body]); },
    updaterIsActive: async () => false,
    claimRun: async body => { calls.push(['claim', body]); return { claimed: true, runId: '11111111-1111-4111-8111-111111111111' }; },
    startUpdater: async runId => { calls.push(['start', runId]); return { exitCode: 0, signal: null }; },
    readRun: async () => ({ status: 'NO_UPDATE' }),
    reportFailure: async (runId, failure) => { calls.push(['failure', runId, failure]); },
    ...overrides,
  };
  return { result: await pollCs2UpdateSchedule(deps), calls };
}

test('disabled central schedule never claims or launches updater', async () => {
  const { result, calls } = await runPoll();
  assert.equal(result.action, 'DISABLED');
  assert.equal(calls.some(call => call[0] === 'claim' || call[0] === 'start'), false);
});

test('ordinary poll minute performs only a heartbeat and no updater work', async () => {
  const { result, calls } = await runPoll({ readSchedule: async () => ({ schedule: { enabled: true, localTime: '05:00', revision: 4 }, due: null }) });
  assert.equal(result.action, 'NOT_DUE');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'heartbeat');
});

test('due schedule claims once and launches the updater with the returned run ID', async () => {
  const { result, calls } = await runPoll({
    readSchedule: async () => ({ schedule: { enabled: true, localTime: '05:00', revision: 7 }, due: { localDate: '2026-10-27', localTime: '05:00' } }),
  });
  assert.equal(result.action, 'NO_UPDATE');
  assert.deepEqual(calls.filter(call => call[0] === 'start'), [['start', '11111111-1111-4111-8111-111111111111']]);
  assert.deepEqual(calls.find(call => call[0] === 'claim')[1], { localDate: '2026-10-27', localTime: '05:00', revision: 7 });
});

test('already active updater and already claimed date cannot launch a second process', async () => {
  const active = await runPoll({
    readSchedule: async () => ({ schedule: { enabled: true, localTime: '05:00', revision: 1 }, due: { localDate: '2026-10-27', localTime: '05:00' } }),
    updaterIsActive: async () => true,
  });
  assert.equal(active.result.action, 'UPDATE_RUNNING');
  assert.equal(active.calls.some(call => call[0] === 'claim' || call[0] === 'start'), false);

  const claimed = await runPoll({
    readSchedule: async () => ({ schedule: { enabled: true, localTime: '05:00', revision: 1 }, due: { localDate: '2026-10-27', localTime: '05:00' } }),
    claimRun: async () => ({ claimed: false, reason: 'ALREADY_CLAIMED_TODAY' }),
  });
  assert.equal(claimed.result.action, 'ALREADY_CLAIMED_TODAY');
  assert.equal(claimed.calls.some(call => call[0] === 'start'), false);
});

test('schedule API outage or invalid config fails closed without claiming or launching', async () => {
  const offline = await runPoll({ readSchedule: async () => { throw new Error('HTTP 503'); } });
  assert.equal(offline.result.action, 'BLOCKED');
  assert.equal(offline.calls.some(call => call[0] === 'claim' || call[0] === 'start'), false);

  const invalid = await runPoll({ readSchedule: async () => ({ invalid: true, schedule: null, due: null }) });
  assert.equal(invalid.result.reason, 'SCHEDULE_INVALID');
  assert.equal(invalid.calls.some(call => call[0] === 'claim' || call[0] === 'start'), false);
});

test('failed updater child is reported as a failure rather than accepted', async () => {
  const { result, calls } = await runPoll({
    readSchedule: async () => ({ schedule: { enabled: true, localTime: '05:00', revision: 1 }, due: { localDate: '2026-10-27', localTime: '05:00' } }),
    startUpdater: async () => ({ exitCode: 1, signal: null }),
    readRun: async () => ({ status: 'RUNNING' }),
  });
  assert.equal(result.action, 'FAILED');
  assert.equal(calls.some(call => call[0] === 'failure'), true);
});
