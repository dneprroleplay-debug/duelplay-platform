import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  CS2_RECOVERY_MARKER_MAX_AGE_MS,
  cs2RecoveryIdForRun,
  runControlledCs2Recovery,
  assertCs2RecoveryMarkerForPhase,
} from '../lib/cs2-update-recovery.mjs';

const RUN_ID = '5b6a8e7c-4d3f-4a2b-9c1d-123456789abc';
const RECOVERY_ID = cs2RecoveryIdForRun(RUN_ID);
const NOW = Date.parse('2026-10-29T13:15:00.000Z');
const OLD_MARKER_TIME = NOW - 568 * 60_000;

function makeSnapshot(overrides = {}) {
  const servers = ['cs2-1', 'cs2-2', 'cs2-3'].map(name => ({
    name,
    status: 'READY',
    matchId: null,
    processId: null,
    managerReady: true,
    gameProcessReady: false,
    gameProcessStatus: 'STOPPED',
    gameProcessPid: null,
    heartbeatFresh: true,
    lastHeartbeat: new Date(NOW - 2_000).toISOString(),
  }));
  return {
    maintenance: true,
    activeMatches: 0,
    updateStatus: { status: 'FAILED', runId: RUN_ID, startedAt: '2026-10-29T03:39:15.000Z', error: 'INVALID_RUN_UPDATE' },
    servers,
    ...overrides,
  };
}

function makeRun(overrides = {}) {
  return {
    id: RUN_ID,
    status: 'FAILED',
    errorCode: 'CS2_UPDATE_FAILED',
    errorMessage: 'DuelPlay update API returned HTTP 400 (INVALID_RUN_UPDATE)',
    publicBuildId: '26281801',
    installedBuildIdAfter: '26281801',
    serverVersionAfter: '2000938',
    checkedInstances: ['cs2-1', 'cs2-2', 'cs2-3'].map(serverName => ({
      serverName, status: 'READY', buildId: '26281801', serverVersion: '2000938',
      controlFilesVerified: true, smokeStatus: 'READY', managerReady: false,
      gameProcessReady: false, gameProcessStatus: 'STOPPED', gameProcessPid: null,
    })),
    startedAt: new Date('2026-10-29T03:39:15.000Z'),
    ...overrides,
  };
}

function makeOldMarker() {
  return {
    mtimeMs: OLD_MARKER_TIME,
    size: 64,
    ino: 101,
    dev: 1,
    content: { pid: 3177636, startedAt: new Date(OLD_MARKER_TIME).toISOString() },
  };
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function makeApi({ snapshot = makeSnapshot(), run = makeRun(), failAction = null, commitThenThrow = null } = {}) {
  let failingAction = failAction;
  const state = { snapshot: clone(snapshot), run: clone(run), ledger: null, audit: [], calls: [] };
  const api = {
    state,
    setFailAction(value) { failingAction = value; },
    async inspect() {
      return { snapshot: clone(state.snapshot), run: clone(state.run), ledger: clone(state.ledger) };
    },
    async action(action, payload) {
      state.calls.push(action);
      if (failingAction === action) throw new Error(`SIMULATED_DB_FAILURE_${action}`);
      const nowIso = new Date(NOW).toISOString();
      if (action === 'prepare') {
        if (!state.ledger) {
          state.ledger = { recoveryId: RECOVERY_ID, runId: RUN_ID, phase: 'PREPARED', markerOwnershipToken: 'cd'.repeat(32), startedAt: nowIso, updatedAt: nowIso };
          state.audit.push('PREPARED');
        }
      } else if (action === 'marker-refreshed') {
        if (state.ledger.phase === 'PREPARED' || state.ledger.phase === 'MARKER_REFRESHED') {
          const wasPrepared = state.ledger.phase === 'PREPARED';
          state.ledger = {
            ...state.ledger, phase: 'MARKER_REFRESHED', updatedAt: nowIso,
            markerPid: payload.markerPid, markerDev: payload.markerDev, markerIno: payload.markerIno,
            markerMtimeMs: payload.markerMtimeMs, markerSize: payload.markerSize,
          };
          if (wasPrepared) state.audit.push('MARKER_REFRESHED');
        }
      } else if (action === 'complete') {
        if (state.ledger.phase === 'MARKER_REFRESHED') {
          state.snapshot.updateStatus = {
            status: 'SUCCEEDED',
            recoveryId: RECOVERY_ID,
            recoveredFromRunId: RUN_ID,
            startedAt: state.run.startedAt.toISOString(),
            finishedAt: nowIso,
          };
          state.ledger = {
            ...state.ledger, phase: 'STATUS_UPDATED', updatedAt: nowIso,
            markerCleanupNonce: 'ab'.repeat(32),
          };
          state.audit.push('STATUS_UPDATED');
        }
      } else if (action === 'finalize') {
        assert.equal(payload.markerReceipt.recoveryId, RECOVERY_ID);
        assert.equal(payload.markerReceipt.phase, 'STATUS_UPDATED');
        assert.equal(payload.markerReceipt.nonce, state.ledger.markerCleanupNonce);
        assert.equal(payload.markerReceipt.marker.ino, state.ledger.markerIno);
        assert.equal(['UNLINKED', 'ABSENT_ON_RETRY'].includes(payload.markerReceipt.disposition), true);
        if (state.ledger.phase === 'STATUS_UPDATED') {
          state.ledger = {
            ...state.ledger, phase: 'COMPLETED', updatedAt: nowIso,
            markerCleanupReceipt: clone(payload.markerReceipt),
          };
          state.audit.push('COMPLETED');
        }
      } else {
        throw new Error(`UNKNOWN_ACTION_${action}`);
      }
      if (commitThenThrow === action) {
        commitThenThrow = null;
        throw new Error(`SIMULATED_RESPONSE_LOST_AFTER_COMMIT_${action}`);
      }
      return { phase: state.ledger.phase, ledger: clone(state.ledger) };
    },
  };
  return api;
}

function makeMarker({ initial = makeOldMarker(), failWrite = false, failRemove = false } = {}) {
  let value = clone(initial);
  const calls = [];
  return {
    calls,
    async read() { return clone(value); },
    async writeRecoveryMarker(content, expected) {
      calls.push('write');
      if (failWrite) throw new Error('SIMULATED_FILE_WRITE_FAILURE');
      if (expected === null && value !== null) {
        if (value?.content?.recoveryId === content.recoveryId && value.content?.source === 'duelplay-controlled-recovery' && value.content?.ownershipToken === content.ownershipToken) return clone(value);
        throw new Error('SIMULATED_MARKER_APPEARED');
      }
      if (expected && (!value || value.dev !== expected.dev || value.ino !== expected.ino || value.mtimeMs !== expected.mtimeMs || value.size !== expected.size)) {
        if (value?.content?.recoveryId === content.recoveryId && value.content?.ownershipToken === content.ownershipToken) return clone(value);
        throw new Error('SIMULATED_MARKER_CHANGED');
      }
      value = {
        mtimeMs: NOW,
        size: JSON.stringify(content).length,
        ino: 202,
        dev: 1,
        content: clone(content),
      };
      return clone(value);
    },
    async removeOwnedRecoveryMarker(recoveryId, ownershipToken, expectedIdentity) {
      calls.push('remove');
      if (failRemove) throw new Error('SIMULATED_FILE_UNLINK_FAILURE');
      if (!value || value.content?.recoveryId !== recoveryId || value.content?.source !== 'duelplay-controlled-recovery' || value.content?.ownershipToken !== ownershipToken) throw new Error('SIMULATED_MARKER_OWNERSHIP_MISMATCH');
      if (expectedIdentity && (value.dev !== expectedIdentity.dev || value.ino !== expectedIdentity.ino
        || value.mtimeMs !== expectedIdentity.mtimeMs || value.size !== expectedIdentity.size)) throw new Error('SIMULATED_MARKER_OWNERSHIP_MISMATCH');
      const receipt = {
        marker: { dev: value.dev, ino: value.ino, mtimeMs: value.mtimeMs, size: value.size },
        disposition: 'UNLINKED',
        observedAt: new Date(NOW).toISOString(),
      };
      value = null;
      return receipt;
    },
    setFailWrite(value) { failWrite = value; },
    setFailRemove(value) { failRemove = value; },
  };
}

async function execute(api, marker) {
  return runControlledCs2Recovery({
    runId: RUN_ID,
    api,
    marker,
    now: () => NOW,
    pidIsAlive: () => false,
    confirm: true,
  });
}

const checks = [];
const skipped = [];

function skip(name, reason) {
  skipped.push([name, reason]);
}
async function test(name, fn) {
  try {
    await fn();
    checks.push([name, true]);
  } catch (error) {
    checks.push([name, false, error]);
  }
}

await test('successful recovery records each phase, preserves FAILED run, and keeps maintenance enabled', async () => {
  const api = makeApi();
  const marker = makeMarker();
  const result = await execute(api, marker);
  assert.equal(result.ok, true);
  assert.equal(result.phase, 'COMPLETED');
  assert.equal(result.maintenanceRemainsEnabled, true);
  assert.equal(api.state.run.status, 'FAILED');
  assert.equal(api.state.snapshot.maintenance, true);
  assert.equal(api.state.snapshot.updateStatus.status, 'SUCCEEDED');
  assert.equal(api.state.snapshot.updateStatus.recoveredFromRunId, RUN_ID);
  assert.deepEqual(api.state.audit, ['PREPARED', 'MARKER_REFRESHED', 'STATUS_UPDATED', 'COMPLETED']);
  assert.equal(await marker.read(), null);
});

await test('repeated call after completion is idempotent and does not mutate the FAILED run', async () => {
  const api = makeApi();
  const marker = makeMarker();
  await execute(api, marker);
  const auditsBefore = api.state.audit.length;
  const callsBefore = api.state.calls.length;
  const second = await execute(api, marker);
  assert.equal(second.phase, 'COMPLETED');
  assert.equal(api.state.audit.length, auditsBefore);
  assert.equal(api.state.run.status, 'FAILED');
  assert.deepEqual(api.state.calls.slice(callsBefore), ['prepare']);
});

await test('rejects stale heartbeat before any API mutation', async () => {
  const snapshot = makeSnapshot();
  snapshot.servers[0].lastHeartbeat = new Date(NOW - 30_001).toISOString();
  const api = makeApi({ snapshot });
  const marker = makeMarker();
  await assert.rejects(() => execute(api, marker), /CS2_HEARTBEAT_STALE/);
  assert.deepEqual(api.state.calls, []);
  assert.deepEqual(marker.calls, []);
});

await test('rejects an active match before any API mutation', async () => {
  const api = makeApi({ snapshot: makeSnapshot({ activeMatches: 1 }) });
  const marker = makeMarker();
  await assert.rejects(() => execute(api, marker), /ACTIVE_MATCHES_PRESENT/);
  assert.deepEqual(api.state.calls, []);
  assert.deepEqual(marker.calls, []);
});

await test('rejects a missing manager and does not touch the marker', async () => {
  const snapshot = makeSnapshot({ servers: makeSnapshot().servers.slice(0, 2) });
  const api = makeApi({ snapshot });
  const marker = makeMarker();
  await assert.rejects(() => execute(api, marker), /CS2_SERVER_SET_INCOMPLETE/);
  assert.deepEqual(api.state.calls, []);
  assert.deepEqual(marker.calls, []);
});

await test('rejects missing or inconsistent persisted instance verification evidence', async () => {
  const run = makeRun({ checkedInstances: makeRun().checkedInstances.map((row, i) =>
    i === 1 ? { ...row, serverVersion: 'mismatch' } : row) });
  const api = makeApi({ run });
  const marker = makeMarker();
  await assert.rejects(() => execute(api, marker), /PERSISTED_INSTANCE_EVIDENCE_MISMATCH/);
  assert.deepEqual(api.state.calls, []);
  assert.deepEqual(marker.calls, []);
});

await test('refuses to start when a conflicting updater or game process is detected', async () => {
  const api = makeApi();
  const marker = makeMarker();
  await assert.rejects(() => runControlledCs2Recovery({
    runId: RUN_ID,
    api,
    marker,
    now: () => NOW,
    pidIsAlive: () => false,
    assertNoConflictingProcesses: async () => { throw new Error('CONFLICTING_PROCESS_ACTIVE'); },
    confirm: true,
  }), /CONFLICTING_PROCESS_ACTIVE/);
  assert.deepEqual(api.state.calls, []);
  assert.deepEqual(marker.calls, []);
});

await test('database preparation failure leaves the old marker and global FAILED status intact', async () => {
  const api = makeApi({ failAction: 'prepare' });
  const marker = makeMarker();
  await assert.rejects(() => execute(api, marker), /SIMULATED_DB_FAILURE_prepare/);
  assert.equal(api.state.ledger, null);
  assert.equal(api.state.snapshot.updateStatus.status, 'FAILED');
  assert.equal(api.state.snapshot.maintenance, true);
  assert.equal((await marker.read()).content.pid, 3177636);
});

await test('file write failure leaves the DB journal PREPARED and remains safely retryable', async () => {
  const api = makeApi();
  const marker = makeMarker({ failWrite: true });
  await assert.rejects(() => execute(api, marker), /SIMULATED_FILE_WRITE_FAILURE/);
  assert.equal(api.state.ledger.phase, 'PREPARED');
  assert.equal(api.state.snapshot.updateStatus.status, 'FAILED');
  assert.equal(api.state.snapshot.maintenance, true);
  marker.setFailWrite(false);
  const retry = await execute(api, marker);
  assert.equal(retry.phase, 'COMPLETED');
  assert.equal(api.state.run.status, 'FAILED');
});

await test('DB response loss after marker refresh resumes from recorded phase', async () => {
  const api = makeApi({ commitThenThrow: 'marker-refreshed' });
  const marker = makeMarker();
  await assert.rejects(() => execute(api, marker), /SIMULATED_RESPONSE_LOST_AFTER_COMMIT_marker-refreshed/);
  assert.equal(api.state.ledger.phase, 'MARKER_REFRESHED');
  assert.equal((await marker.read()).content.recoveryId, RECOVERY_ID);
  const retry = await execute(api, marker);
  assert.equal(retry.phase, 'COMPLETED');
  assert.equal(api.state.snapshot.maintenance, true);
});

await test('retry after an interruption over 60 seconds after marker write refreshes the recovery-owned marker', async () => {
  const api = makeApi();
  api.state.ledger = {
    version: 1, recoveryId: RECOVERY_ID, runId: RUN_ID, phase: 'PREPARED', markerOwnershipToken: 'cd'.repeat(32),
    startedAt: new Date(NOW - 180_000).toISOString(),
    updatedAt: new Date(NOW - 120_000).toISOString(),
  };
  const staleOwned = {
    mtimeMs: NOW - 120_000,
    size: 120,
    ino: 202,
    dev: 1,
    content: {
      source: 'duelplay-controlled-recovery', recoveryId: RECOVERY_ID, ownershipToken: 'cd'.repeat(32),
      pid: 99999, startedAt: new Date(NOW - 120_000).toISOString(),
    },
  };
  const marker = makeMarker({ initial: staleOwned });
  const result = await execute(api, marker);
  assert.equal(result.phase, 'COMPLETED');
  assert.equal(marker.calls.filter(call => call === 'write').length, 1);
  assert.equal(api.state.run.status, 'FAILED');
});

await test('file marker refresh can succeed before DB phase update fails, then resumes without overwriting the marker', async () => {
  const api = makeApi({ failAction: 'marker-refreshed' });
  const marker = makeMarker();
  await assert.rejects(() => execute(api, marker), /SIMULATED_DB_FAILURE_marker-refreshed/);
  assert.equal(api.state.ledger.phase, 'PREPARED');
  assert.equal((await marker.read()).content.recoveryId, RECOVERY_ID);
  assert.equal(api.state.snapshot.maintenance, true);
  api.setFailAction(null);
  const retry = await execute(api, marker);
  assert.equal(retry.phase, 'COMPLETED');
  assert.equal(marker.calls.filter(call => call === 'write').length, 1);
});

await test('DB failure before global status commit leaves refreshed marker active and maintenance enabled', async () => {
  const api = makeApi({ failAction: 'complete' });
  const marker = makeMarker();
  await assert.rejects(() => execute(api, marker), /SIMULATED_DB_FAILURE_complete/);
  assert.equal(api.state.ledger.phase, 'MARKER_REFRESHED');
  assert.equal(api.state.snapshot.updateStatus.status, 'FAILED');
  assert.equal(api.state.snapshot.maintenance, true);
  assert.equal((await marker.read()).content.recoveryId, RECOVERY_ID);
});

await test('unlink failure leaves maintenance enabled and successful DB state resumable', async () => {
  const api = makeApi();
  const marker = makeMarker({ failRemove: true });
  await assert.rejects(() => execute(api, marker), /SIMULATED_FILE_UNLINK_FAILURE/);
  assert.equal(api.state.ledger.phase, 'STATUS_UPDATED');
  assert.equal(api.state.snapshot.updateStatus.status, 'SUCCEEDED');
  assert.equal(api.state.snapshot.maintenance, true);
  marker.setFailRemove(false);
  const retry = await execute(api, marker);
  assert.equal(retry.phase, 'COMPLETED');
  assert.equal(await marker.read(), null);
});

await test('interruption after status DB commit but before response resumes marker cleanup', async () => {
  const api = makeApi({ commitThenThrow: 'complete' });
  const marker = makeMarker();
  await assert.rejects(() => execute(api, marker), /SIMULATED_RESPONSE_LOST_AFTER_COMMIT_complete/);
  assert.equal(api.state.ledger.phase, 'STATUS_UPDATED');
  assert.equal(api.state.snapshot.maintenance, true);
  assert.equal((await marker.read()).content.recoveryId, RECOVERY_ID);
  const retry = await execute(api, marker);
  assert.equal(retry.phase, 'COMPLETED');
  assert.equal(await marker.read(), null);
});

await test('interruption after marker deletion but before final audit is resumed idempotently', async () => {
  const api = makeApi({ failAction: 'finalize' });
  const marker = makeMarker();
  await assert.rejects(() => execute(api, marker), /SIMULATED_DB_FAILURE_finalize/);
  assert.equal(api.state.ledger.phase, 'STATUS_UPDATED');
  assert.equal(await marker.read(), null);
  assert.equal(api.state.snapshot.maintenance, true);
  api.state.calls.splice(0, api.state.calls.length);
  api.setFailAction(null);
  const retry = await execute(api, marker);
  assert.equal(retry.phase, 'COMPLETED');
  assert.deepEqual(api.state.calls, ['prepare', 'finalize']);
});

await test('rejects a non-stale marker and leaves the state untouched', async () => {
  const markerState = makeOldMarker();
  markerState.mtimeMs = NOW - CS2_RECOVERY_MARKER_MAX_AGE_MS + 1;
  const api = makeApi();
  const marker = makeMarker({ initial: markerState });
  await assert.rejects(() => execute(api, marker), /SYNC_MARKER_NOT_STALE/);
  assert.deepEqual(api.state.calls, []);
  assert.deepEqual(marker.calls, []);
});

await test('refuses to remove a marker owned by another operation', async () => {
  const api = makeApi();
  const marker = makeMarker();
  await execute(api, marker);
  const changedMarker = makeMarker({ initial: {
    mtimeMs: NOW,
    size: 80,
    ino: 303,
    dev: 1,
    content: { pid: 222, startedAt: new Date(NOW).toISOString(), source: 'other-operation', recoveryId: 'other' },
  } });
  await assert.rejects(() => execute(api, changedMarker), /RECOVERY_STATUS_MISMATCH|SYNC_MARKER_OWNERSHIP_MISMATCH/);
});

await test('route uses signed requests, DB locks, transactional gate checks, and append-only audit events', async () => {
  const route = fs.readFileSync(new URL('../app/api/server-manager/update-recovery/route.ts', import.meta.url), 'utf8');
  assert.equal(route.includes('isFreshServerManagerRequest(request)'), true);
  assert.equal(route.includes("duelplay:maintenance-match-ops"), true);
  assert.equal(route.includes("duelplay:cs2-update-recovery"), true);
  assert.equal(route.includes('assertCs2RecoverySnapshot(state.snapshot'), true);
  assert.equal(route.includes('tx.auditLog.create('), true);
  assert.equal(route.includes('markerMtimeMs') && route.includes('CS2_RECOVERY_MARKER_EVIDENCE_INVALID'), true);
  assert.equal(route.includes('markerCleanupNonce'), true);
  assert.equal(route.includes('markerOwnershipToken: randomBytes(32).toString("hex")'), true);
  assert.equal(route.includes('validateMarkerEvidence(body, now, existing.markerOwnershipToken)'), true);
  assert.equal(route.includes('markerReceiptMatchesLedger(receipt, existing, now.getTime())'), true);
  assert.equal(route.includes('body.markerAbsent !== true'), false);
  assert.equal(route.includes('tx.cs2UpdateRun.update('), false);
  assert.equal(route.includes('enabled: false'), false);
  assert.equal(route.includes('app_update'), false);
  assert.equal(route.includes('steamcmd'), false);
});

await test('recovery executor explicitly imports spawnSync from node:child_process', async () => {
  const script = fs.readFileSync(new URL('./server-manager/recover-cs2-update-state.mjs', import.meta.url), 'utf8');
  assert.match(script, /import\s+\{\s*spawnSync\s*\}\s+from\s+['"]node:child_process['"]/,
    'spawnSync is used for read-only process checks and must be imported');
  assert.match(script, /spawnSync\('pgrep'/, 'expected the process checker to use the imported spawnSync binding');
});

await test('legacy API guard patch does not remove or replace FINALIZING', async () => {
  const patchPath = new URL('../patches/legacy-api-recovery-guards.patch', import.meta.url);
  assert.equal(fs.existsSync(patchPath), true, 'patches/legacy-api-recovery-guards.patch is required');
  const patch = fs.readFileSync(patchPath, 'utf8');
  assert.equal(/^[-]\s*.*FINALIZING/m.test(patch), false,
    'patch must not remove or replace FINALIZING');
  assert.equal(/^[-]\s*const RUN_STAGES/m.test(patch), false,
    'patch must not replace the RUN_STAGES definition');
});

const updateRunsRouteUrl = new URL('../app/api/server-manager/update-runs/route.ts', import.meta.url);
if (!fs.existsSync(updateRunsRouteUrl)) {
  skip(
    'integrated update-runs route contains FINALIZING exactly once',
    'app/api/server-manager/update-runs/route.ts is absent from this delta package. The patch-only test passed, but the integrated route cannot be inspected here. Apply/review the patch against the actual project while preserving FINALIZING, then rerun tests from the integrated project.'
  );
} else {
  await test('integrated update-runs route contains FINALIZING exactly once', async () => {
    const route = fs.readFileSync(updateRunsRouteUrl, 'utf8');
    const stageSet = route.match(/const RUN_STAGES\s*=\s*new Set\(\s*\[([\s\S]*?)\]\s*\)/);
    assert.ok(stageSet, 'integrated route must define RUN_STAGES as a Set');
    const occurrences = [...stageSet[1].matchAll(/["']FINALIZING["']/g)].length;
    assert.equal(occurrences, 1,
      `RUN_STAGES must contain FINALIZING exactly once; found ${occurrences}`);
  });
}

await test('production executor requires explicit confirmation and contains no updater or game launch calls', async () => {
  const script = fs.readFileSync(new URL('./server-manager/recover-cs2-update-state.mjs', import.meta.url), 'utf8');
  assert.equal(script.includes("argv.includes('--confirm')"), true);
  assert.equal(script.includes('createUpdateScheduleClient'), true);
  assert.equal(script.includes('assertNoConflictingProcesses'), true);
  assert.equal(script.includes("args: ['-af', 'update-all[.]mjs']"), true);
  assert.equal(script.includes("args: ['-x', 'cs2_linux64']"), true);
  assert.equal(script.includes("args: ['-af', 'cs2[.]sh']"), true);
  assert.equal(script.includes('enterFlockOrRelaunch'), true);
  assert.equal(script.includes('createMarkerAdapter'), true,
    'marker ownership operations must be delegated to the guarded marker adapter');
  const markerAdapter = fs.readFileSync(new URL('../lib/cs2-update-recovery-marker.mjs', import.meta.url), 'utf8');
  assert.equal(markerAdapter.includes('removeOwnedRecoveryMarker'), true,
    'owned marker deletion must live in the marker adapter');
  assert.equal(script.includes('+app_update'), false);
  assert.equal(script.includes('STEAMCMD_BIN'), false);
});

const recoveryGuardHelperPath = new URL('../lib/cs2-update-recovery-guard.ts', import.meta.url);
const recoveryGuardPatchPath = new URL('../patches/legacy-api-recovery-guards.patch', import.meta.url);
const guardRoutes = [
  ['../app/api/server-manager/maintenance/route.ts', 'getUnfinishedCs2RecoveryKeys(tx)'],
  ['../app/api/server-manager/update-runs/finalize/route.ts', 'getUnfinishedCs2RecoveryKeys(tx)'],
  ['../app/api/server-manager/update-runs/route.ts', 'getUnfinishedCs2RecoveryKeys(tx)'],
  ['../app/api/server-manager/update-schedule/claim/route.ts', 'getUnfinishedCs2RecoveryKeys(tx)'],
  ['../app/api/maintenance/route.ts', 'getUnfinishedCs2RecoveryKeys(tx)'],
  ['../app/api/feature-flags/route.ts', 'getUnfinishedCs2RecoveryKeys(tx)'],
  ['../app/api/admin/route.ts', 'getUnfinishedCs2RecoveryKeys(tx)'],
];

function integratedGuardPrerequisites() {
  const missing = [];
  if (!fs.existsSync(recoveryGuardPatchPath)) {
    missing.push('patches/legacy-api-recovery-guards.patch (recovery guard patch is missing)');
  }
  if (!fs.existsSync(recoveryGuardHelperPath)) {
    missing.push('lib/cs2-update-recovery-guard.ts');
  } else {
    const helper = fs.readFileSync(recoveryGuardHelperPath, 'utf8');
    for (const required of [
      'CS2_UPDATE_RECOVERY_V1_',
      'isValidCompletedRecoveryRow(row.key, row.value)',
      'updatedAt >= startedAt',
      'Number.isSafeInteger(value.markerPid)',
    ]) {
      if (!helper.includes(required)) missing.push(`lib/cs2-update-recovery-guard.ts (missing ${required})`);
    }
  }

  for (const [relativePath, guardCall] of guardRoutes) {
    const url = new URL(relativePath, import.meta.url);
    if (!fs.existsSync(url)) {
      missing.push(`${relativePath.replace(/^\.\.\//, '')} (file required by the integration patch is missing)`);
      continue;
    }
    const route = fs.readFileSync(url, 'utf8');
    if (!route.includes(guardCall)) {
      missing.push(`${relativePath.replace(/^\.\.\//, '')} (shared recovery journal guard is not integrated)`);
    } else if (!route.includes('CS2_RECOVERY_IN_PROGRESS') && !route.includes('blockedRecoveryKeys')) {
      missing.push(`${relativePath.replace(/^\.\.\//, '')} (no fail-closed recovery response found)`);
    }
    if (!route.includes("duelplay:maintenance-match-ops")) {
      missing.push(`${relativePath.replace(/^\.\.\//, '')} (missing maintenance/recovery serialization lock)`);
    }
  }

  const updateRunsUrl = new URL('../app/api/server-manager/update-runs/route.ts', import.meta.url);
  if (fs.existsSync(updateRunsUrl)) {
    const updateRuns = fs.readFileSync(updateRunsUrl, 'utf8');
    if (!/const RUN_STAGES\s*=\s*new Set\([\s\S]*?["']FINALIZING["']/.test(updateRuns)) {
      missing.push('app/api/server-manager/update-runs/route.ts (deployed FINALIZING stage must remain present)');
    }
  }
  return [...new Set(missing)];
}

const guardIntegrationMissing = integratedGuardPrerequisites();
if (guardIntegrationMissing.length > 0) {
  skip(
    'all maintenance-disable routes share the recovery journal guard',
    `Integrated-state check was not run; package-only tests do not apply this patch. Required/missing items:\n${guardIntegrationMissing.map(item => `  - ${item}`).join('\n')}\nApply/review patches/legacy-api-recovery-guards.patch against the current project, preserving FINALIZING, then rerun this test.`
  );
} else {
  await test('all maintenance-disable routes share the recovery journal guard (integrated state)', async () => {
    const helper = fs.readFileSync(recoveryGuardHelperPath, 'utf8');
    assert.equal(helper.includes('CS2_UPDATE_RECOVERY_V1_'), true);
    assert.equal(helper.includes('isValidCompletedRecoveryRow(row.key, row.value)'), true);
    assert.equal(helper.includes('updatedAt >= startedAt'), true);
    assert.equal(helper.includes('Number.isSafeInteger(value.markerPid)'), true);

    for (const [relativePath, guardCall] of guardRoutes) {
      const route = fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');
      assert.equal(route.includes(guardCall), true, `${relativePath} must call the shared guard`);
      assert.equal(route.includes('CS2_RECOVERY_IN_PROGRESS') || route.includes('blockedRecoveryKeys'), true,
        `${relativePath} must fail closed while recovery is incomplete`);
      assert.equal(route.includes('duelplay:maintenance-match-ops'), true,
        `${relativePath} must serialize updater/recovery state changes`);
    }
    const updateRuns = fs.readFileSync(new URL('../app/api/server-manager/update-runs/route.ts', import.meta.url), 'utf8');
    assert.match(updateRuns, /const RUN_STAGES\s*=\s*new Set\([\s\S]*?["']FINALIZING["']/,
      'integrated guard state must preserve the FINALIZING stage fix');
  });
}

let failed = 0;
let passed = 0;
for (const [name, ok, error] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (ok) passed += 1;
  else {
    failed += 1;
    console.error(error);
  }
}
for (const [name, reason] of skipped) {
  console.log(`SKIP ${name}`);
  console.log(reason);
}
console.log(`\nCS2 controlled recovery tests: ${passed} passed, ${failed} failed, ${skipped.length} skipped (${checks.length + skipped.length} total scenarios/steps)`);
if (failed > 0) process.exitCode = 1;
