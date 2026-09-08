import { strict as assert } from 'node:assert';
import { buildLiveMatchState } from '../lib/live-match.ts';

const now = Date.parse('2026-09-05T20:00:00.000Z');
const healthy = buildLiveMatchState({
  state: 'READY',
  connectUrl: 'steam://connect/127.0.0.1:27015',
  connectedSteamIds: ['7656111', '7656111', '7656112'],
  connectionPhaseCompleted: true,
  playerOneSteamId: 'secret-1',
}, now, new Date(now - 10_000));
assert.equal(healthy.connectedCount, 2);
assert.equal(healthy.connectionSlots, 2);
assert.equal(healthy.connectionPhaseCompleted, true);
assert.equal(healthy.serverHealthy, true);
assert.equal(healthy.heartbeatAgeMs, 10_000);

const stale = buildLiveMatchState({ state: 'LIVE', connectedSteamIds: ['7656111'] }, now, new Date(now - 91_000));
assert.equal(stale.connectedCount, 1);
assert.equal(stale.serverHealthy, false);
assert.equal(stale.connectUrl, null);

const empty = buildLiveMatchState(null, now, null);
assert.equal(empty.connectedCount, 0);
assert.equal(empty.serverHealthy, false);
console.log('live match policy: PASS');
