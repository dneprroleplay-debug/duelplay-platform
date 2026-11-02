import assert from 'node:assert/strict';
import {
  REQUIRED_CS2_SERVERS,
  classifyStaleUpdaterState,
  clusterIsIdleAndHealthy,
  decideStaleMaintenanceRelease,
} from '../lib/cs2-maintenance-reconcile.mjs';

const NOW = Date.parse('2026-11-02T12:00:00.000Z');

function healthyServer(name) {
  return {
    name,
    status: 'READY',
    matchId: null,
    processId: null,
    managerReady: true,
    gameProcessReady: false,
    gameProcessStatus: 'STOPPED',
    gameProcessPid: null,
    heartbeatFresh: true,
  };
}

function snapshot(overrides = {}) {
  return {
    maintenance: true,
    activeMatches: 0,
    updateStatus: { status: 'FAILED', runId: 'run-1', startedAt: '2026-11-02T11:55:00.000Z' },
    servers: REQUIRED_CS2_SERVERS.map(healthyServer),
    ...overrides,
  };
}

assert.deepEqual(REQUIRED_CS2_SERVERS, ['cs2-1', 'cs2-2', 'cs2-3']);

assert.deepEqual(classifyStaleUpdaterState(null, { now: NOW }), { stale: false, reason: 'UPDATE_STATUS_MISSING' });
assert.equal(classifyStaleUpdaterState(snapshot({ updateStatus: { status: 'NO_UPDATE', startedAt: '2026-11-02T11:00:00.000Z' } }).updateStatus, { now: NOW }).reason, 'STATUS_NO_UPDATE_NOT_AUTO_RECOVERABLE');
assert.equal(classifyStaleUpdaterState({ status: 'SUCCEEDED', startedAt: '2026-11-02T11:00:00.000Z' }, { now: NOW }).stale, false);
assert.deepEqual(classifyStaleUpdaterState({ status: 'FAILED', startedAt: '2026-11-02T11:00:00.000Z' }, { now: NOW }), { stale: true, reason: 'FAILED_UPDATE_LEFT_MAINTENANCE_ON' });
assert.deepEqual(classifyStaleUpdaterState({ status: 'RUNNING', startedAt: '2026-11-02T11:55:00.000Z' }, { now: NOW }), { stale: false, reason: 'RUNNING_RECENT' });
assert.deepEqual(classifyStaleUpdaterState({ status: 'RUNNING', startedAt: '2026-11-02T11:45:00.000Z' }, { now: NOW }), { stale: true, reason: 'ABANDONED_RUNNING_UPDATE' });
assert.equal(classifyStaleUpdaterState({ status: 'FAILED', startedAt: '2026-11-02T12:05:00.000Z' }, { now: NOW }).reason, 'STARTED_AT_IN_FUTURE');
assert.equal(classifyStaleUpdaterState({ status: 'FAILED', startedAt: 'not-a-date' }, { now: NOW }).reason, 'STARTED_AT_UNKNOWN');

assert.equal(clusterIsIdleAndHealthy(snapshot()), true);
assert.equal(clusterIsIdleAndHealthy(snapshot({ activeMatches: 1 })), false);
assert.equal(clusterIsIdleAndHealthy(snapshot({ servers: REQUIRED_CS2_SERVERS.slice(0, 2).map(healthyServer) })), false);
assert.equal(clusterIsIdleAndHealthy(snapshot({ servers: [healthyServer('cs2-1'), healthyServer('cs2-2'), healthyServer('cs2-4')] })), false);
assert.equal(clusterIsIdleAndHealthy(snapshot({ servers: [healthyServer('cs2-1'), healthyServer('cs2-2'), { ...healthyServer('cs2-3'), status: 'UPDATING' }] })), false);
assert.equal(clusterIsIdleAndHealthy(snapshot({ servers: [healthyServer('cs2-1'), healthyServer('cs2-2'), { ...healthyServer('cs2-3'), matchId: 'match-1' }] })), false);
assert.equal(clusterIsIdleAndHealthy(snapshot({ servers: [healthyServer('cs2-1'), healthyServer('cs2-2'), { ...healthyServer('cs2-3'), processId: 42 }] })), false);
assert.equal(clusterIsIdleAndHealthy(snapshot({ servers: [healthyServer('cs2-1'), healthyServer('cs2-2'), { ...healthyServer('cs2-3'), heartbeatFresh: false }] })), false);

assert.deepEqual(decideStaleMaintenanceRelease(snapshot({ maintenance: false }), { now: NOW }), { release: false, reason: 'MAINTENANCE_DISABLED' });
assert.deepEqual(decideStaleMaintenanceRelease(snapshot(), { now: NOW }), { release: true, reason: 'FAILED_UPDATE_LEFT_MAINTENANCE_ON' });
assert.deepEqual(decideStaleMaintenanceRelease(snapshot({ updateStatus: { status: 'NO_UPDATE', startedAt: '2026-11-02T11:00:00.000Z' } }), { now: NOW }), { release: false, reason: 'STATUS_NO_UPDATE_NOT_AUTO_RECOVERABLE' });
assert.deepEqual(decideStaleMaintenanceRelease(snapshot({ updateStatus: { status: 'NO_UPDATE', startedAt: '2026-11-02T11:00:00.000Z' } }), { now: NOW, force: true }), { release: true, reason: 'EXPLICIT_OPERATOR_RECONCILIATION' });
assert.deepEqual(decideStaleMaintenanceRelease(snapshot({ activeMatches: 1 }), { now: NOW, force: true }), { release: false, reason: 'CLUSTER_NOT_IDLE_AND_HEALTHY' });
assert.deepEqual(decideStaleMaintenanceRelease(snapshot({ servers: [{ ...healthyServer('cs2-1'), gameProcessStatus: 'RUNNING' }, healthyServer('cs2-2'), healthyServer('cs2-3')] }), { now: NOW, force: true }), { release: false, reason: 'CLUSTER_NOT_IDLE_AND_HEALTHY' });

console.log('CS2 maintenance reconcile policy tests passed.');
