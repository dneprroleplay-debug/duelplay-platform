import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CONTROL_FILES,
  assertManagersIdle,
  classifySmokeProcessExit,
  isDeepVerifyDay,
  parseSteamPublicBuildId,
  selectUpdateAction,
  selectSyncMode,
  syncInstances,
} from './sync-policy.mjs';

const MONDAY = new Date('2026-10-19T02:00:00.000Z');
const SUNDAY = new Date('2026-10-18T02:00:00.000Z');
test('parses the current Build ID only from Steam app metadata public branch', () => {
  assert.equal(parseSteamPublicBuildId('"branches" { "public" { "buildid" "26144732" } }'), '26144732');
  assert.equal(parseSteamPublicBuildId('"branches" { "beta" { "buildid" "26144733" } }'), null);
  assert.equal(parseSteamPublicBuildId('unavailable'), null);
});

test('same public and installed Build ID returns NO_UPDATE without app_update or sync, regardless of prior state', () => {
  const plan = selectUpdateAction({
    latestBuildId: '26144732',
    installedBuildId: '26144732',
    previousStatus: 'FAILED',
    state: null,
    forceDeep: true,
    scheduledDeep: true,
  });
  assert.equal(plan.action, 'NO_UPDATE');
  assert.equal(plan.runAppUpdate, false);
  assert.equal(plan.runSync, false);
  assert.equal(plan.deep, false);
});

test('same Build ID with instance differences reports INSTANCE_DRIFT and never repairs automatically', () => {
  const changes = [{ server: 'cs2-1', item: '>f+++++++++', path: 'csgo/maps/custom.vpk' }];
  const plan = selectUpdateAction({
    latestBuildId: '26144732',
    installedBuildId: '26144732',
    instanceDrift: changes,
  });
  assert.equal(plan.action, 'INSTANCE_DRIFT');
  assert.equal(plan.runAppUpdate, false);
  assert.equal(plan.runSync, false);
  assert.deepEqual(plan.changes, changes);
});

test('a changed public Build ID requests one shared SteamCMD update and incremental instance sync', () => {
  const plan = selectUpdateAction({
    latestBuildId: '26144733',
    installedBuildId: '26144732',
  });
  assert.equal(plan.action, 'UPDATE');
  assert.equal(plan.runAppUpdate, true);
  assert.equal(plan.runSync, true);
  assert.equal(plan.deep, true);
});

test('missing public or installed Build ID blocks mutations instead of starting recovery', () => {
  for (const input of [
    { latestBuildId: null, installedBuildId: '26144732' },
    { latestBuildId: '26144732', installedBuildId: null },
  ]) {
    const plan = selectUpdateAction(input);
    assert.equal(plan.action, 'BLOCKED');
    assert.equal(plan.runAppUpdate, false);
    assert.equal(plan.runSync, false);
  }
});

test('manager idle gate blocks an active match before any update action', () => {
  assert.throws(
    () => assertManagersIdle([
      { server: { name: 'cs2-1' }, health: { ok: true, matchId: 'active-match', gameProcessStatus: 'READY', gameProcessPid: 42 } },
      { server: { name: 'cs2-2' }, health: { ok: true, matchId: null, gameProcessStatus: 'STOPPED', gameProcessPid: null } },
      { server: { name: 'cs2-3' }, health: { ok: true, matchId: null, gameProcessStatus: 'STOPPED', gameProcessPid: null } },
    ]),
    /cs2-1: not idle \(matchId=active-match/,
  );
});

test('manager idle gate also blocks a live game process without a match ID', () => {
  assert.throws(
    () => assertManagersIdle([{ server: { name: 'cs2-2' }, health: { ok: true, matchId: null, gameProcessStatus: 'READY', gameProcessPid: 77 } }]),
    /cs2-2: not idle/,
  );
});

test('smoke launch crash before readiness is a fatal failure', () => {
  const result = classifySmokeProcessExit({ exitCode: 139, signalCode: null, readinessChecksPassed: false, quitRequested: false, output: 'Segmentation fault (core dumped)' });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.diagnostic.code, 'SMOKE_PROCESS_CRASH');
});

test('SIGSEGV after complete readiness and controlled quit is explicit diagnostic, not clean success', () => {
  const result = classifySmokeProcessExit({
    exitCode: 139,
    signalCode: null,
    readinessChecksPassed: true,
    quitRequested: true,
    output: 'CHostStateMgr::QueueNewRequest( Quitting, 3 )\nSV: Server shutting down: NETWORK_DISCONNECT_EXITING\nSegmentation fault (core dumped)',
  });
  assert.equal(result.status, 'READY_WITH_SHUTDOWN_DIAGNOSTIC');
  assert.equal(result.diagnostic.code, 'POST_READINESS_SHUTDOWN_SIGSEGV');
});

test('a crash without controlled shutdown evidence cannot use the diagnostic success path', () => {
  const result = classifySmokeProcessExit({
    exitCode: 139,
    signalCode: null,
    readinessChecksPassed: true,
    quitRequested: true,
    output: 'Segmentation fault (core dumped)',
  });
  assert.equal(result.status, 'FAILED');
});

test('a smoke process with clean zero exit is READY', () => {
  assert.equal(classifySmokeProcessExit({ exitCode: 0, signalCode: null, readinessChecksPassed: true, quitRequested: true, output: 'All plugins loaded' }).status, 'READY');
  assert.equal(classifySmokeProcessExit({ exitCode: 0, signalCode: null, readinessChecksPassed: true, quitRequested: false, output: 'All plugins loaded' }).status, 'FAILED');
});

test('sync failure stops the group before later instances can be modified', async () => {
  const syncCalls = [];
  const servers = [{ name: 'cs2-1' }, { name: 'cs2-2' }, { name: 'cs2-3' }];
  await assert.rejects(
    syncInstances({
      servers,
      deep: true,
      sync: async server => {
        syncCalls.push(server.name);
        if (server.name === 'cs2-2') throw new Error('simulated rsync failure');
      },
      verify: async () => {},
    }),
    /simulated rsync failure/,
  );
  assert.deepEqual(syncCalls, ['cs2-1', 'cs2-2']);
});

test('one unsynchronized instance is not silently reported as a successful sync', () => {
  const plan = selectUpdateAction({
    latestBuildId: '26144732',
    installedBuildId: '26144732',
    instanceDrift: [{ server: 'cs2-2', item: '.f..t......', path: 'bin/linuxsteamrt64/cs2' }],
  });
  assert.equal(plan.action, 'INSTANCE_DRIFT');
  assert.equal(plan.runSync, false);
});

test('new Build ID update plan does not depend on stale previous-success metadata', () => {
  const plan = selectUpdateAction({
    latestBuildId: '26144733',
    installedBuildId: '26144732',
    previousStatus: 'FAILED',
    state: null,
  });
  assert.equal(plan.action, 'UPDATE');
  assert.equal(plan.runAppUpdate, true);
  assert.equal(plan.runSync, true);
});

test('deep-verification flags cannot turn an unchanged Steam Build ID into a sync', () => {
  const forcedPlan = selectUpdateAction({
    latestBuildId: '26144732',
    installedBuildId: '26144732',
    instanceDrift: [],
    forceDeep: true,
  });
  assert.equal(forcedPlan.action, 'NO_UPDATE');
  assert.equal(forcedPlan.runAppUpdate, false);
  assert.equal(forcedPlan.runSync, false);
  assert.equal(forcedPlan.deep, false);

  const scheduledPlan = selectUpdateAction({
    latestBuildId: '26144732',
    installedBuildId: '26144732',
    instanceDrift: [],
    scheduledDeep: true,
  });
  assert.equal(scheduledPlan.action, 'NO_UPDATE');
  assert.equal(scheduledPlan.runAppUpdate, false);
  assert.equal(scheduledPlan.runSync, false);
});

test('systemd nonblocking lock admits only one simultaneous updater invocation', { skip: process.platform !== 'linux' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'duelplay-update-lock-'));
  const lockPath = join(root, 'update.lock');
  let first;
  try {
    first = spawn('flock', ['--nonblock', lockPath, 'sh', '-c', 'echo LOCK_HELD; sleep 2'], { stdio: ['ignore', 'pipe', 'ignore'] });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('first flock did not acquire the lock')), 5000);
      first.stdout.on('data', chunk => {
        if (String(chunk).includes('LOCK_HELD')) { clearTimeout(timer); resolve(); }
      });
      first.once('error', error => { clearTimeout(timer); reject(error); });
    });
    const second = spawnSync('flock', ['--nonblock', lockPath, 'true'], { encoding: 'utf8' });
    assert.equal(second.status, 1);
    await new Promise((resolve, reject) => {
      first.once('error', reject);
      first.once('close', code => code === 0 ? resolve() : reject(new Error(`first flock exited ${code}`)));
    });
  } finally {
    first?.kill();
    rmSync(root, { recursive: true, force: true });
  }
});

test('uses quick rsync when the build is unchanged and no deep verification is scheduled', () => {
  assert.equal(MONDAY.getUTCDay(), 1);
  const result = selectSyncMode({
    buildIdBefore: '26144732',
    buildIdAfter: '26144732',
    previousStatus: 'SUCCEEDED',
    now: MONDAY,
    forceDeep: false,
  });
  assert.equal(result.deep, false);
  assert.deepEqual(result.reasons, []);
});

test('uses full checksum when the build id changes', () => {
  const result = selectSyncMode({
    buildIdBefore: '26144732',
    buildIdAfter: '26144733',
    previousStatus: 'SUCCEEDED',
    now: MONDAY,
  });
  assert.equal(result.deep, true);
  assert.match(result.reasons.join('; '), /build id changed/);
});

test('uses full checksum on the scheduled UTC deep-verification day', () => {
  assert.equal(SUNDAY.getUTCDay(), 0);
  assert.equal(isDeepVerifyDay(SUNDAY), true);
  const result = selectSyncMode({
    buildIdBefore: '26144732',
    buildIdAfter: '26144732',
    previousStatus: 'SUCCEEDED',
    now: SUNDAY,
  });
  assert.equal(result.deep, true);
  assert.match(result.reasons.join('; '), /scheduled UTC deep-verification day/);
});

test('uses full checksum when the forced deep-verification flag is enabled', () => {
  const result = selectSyncMode({
    buildIdBefore: '26144732',
    buildIdAfter: '26144732',
    previousStatus: 'SUCCEEDED',
    now: MONDAY,
    forceDeep: true,
  });
  assert.equal(result.deep, true);
  assert.match(result.reasons.join('; '), /DUELPLAY_CS2_DEEP_VERIFY/);
});

test('uses full checksum when the previous run failed or was interrupted', () => {
  for (const previousStatus of ['FAILED', 'RUNNING']) {
    const result = selectSyncMode({
      buildIdBefore: '26144732',
      buildIdAfter: '26144732',
      previousStatus,
      now: MONDAY,
    });
    assert.equal(result.deep, true, previousStatus);
    assert.match(result.reasons.join('; '), new RegExp(`previous update status is ${previousStatus}`));
  }
});

test('uses full checksum when the previous status is missing or unknown', () => {
  for (const previousStatus of [null, undefined, 'PENDING', 'UNKNOWN']) {
    const unknownStatus = selectSyncMode({
      buildIdBefore: '26144732',
      buildIdAfter: '26144732',
      previousStatus,
      now: MONDAY,
    });
    assert.equal(unknownStatus.deep, true, String(previousStatus));
    assert.match(unknownStatus.reasons.join('; '), /previous update status is .*not SUCCEEDED/);
  }

  const missingBuildId = selectSyncMode({
    buildIdBefore: null,
    buildIdAfter: '26144732',
    previousStatus: 'SUCCEEDED',
    now: MONDAY,
  });
  assert.equal(missingBuildId.deep, true);
  assert.match(missingBuildId.reasons.join('; '), /build id is unavailable/);
});

test('falls back to full checksum for one instance when quick verification fails', async () => {
  const syncCalls = [];
  let verifyCalls = 0;
  const result = await syncInstances({
    servers: [{ name: 'cs2-1' }],
    deep: false,
    sync: async (server, deep) => { syncCalls.push([server.name, deep]); },
    verify: async () => {
      verifyCalls += 1;
      if (verifyCalls === 1) throw new Error('version mismatch');
    },
  });
  assert.deepEqual(syncCalls, [['cs2-1', false], ['cs2-1', true]]);
  assert.equal(result.completed, 1);
});

test('fails the operation when the full fallback sync throws', async () => {
  await assert.rejects(
    syncInstances({
      servers: [{ name: 'cs2-1' }],
      deep: false,
      sync: async (_server, deep) => {
        if (deep) throw new Error('rsync full failed');
      },
      verify: async () => { throw new Error('version mismatch'); },
    }),
    /rsync full failed/,
  );
});

test('fails the operation when the full fallback verification still fails', async () => {
  await assert.rejects(
    syncInstances({
      servers: [{ name: 'cs2-1' }],
      deep: false,
      sync: async () => {},
      verify: async () => { throw new Error('hash mismatch'); },
    }),
    /checksum-based incremental synchronization did not verify: hash mismatch/,
  );
});

test('one mismatched instance cannot produce a successful overall result', async () => {
  const servers = [{ name: 'cs2-1' }, { name: 'cs2-2' }, { name: 'cs2-3' }];
  const fullSyncs = [];
  await assert.rejects(
    syncInstances({
      servers,
      deep: false,
      sync: async (server, deep) => {
        if (deep) fullSyncs.push(server.name);
      },
      verify: async (server) => {
        if (server.name === 'cs2-2') throw new Error('cs2-2 version mismatch');
      },
    }),
    /cs2-2: checksum-based incremental synchronization did not verify/,
  );
  assert.deepEqual(fullSyncs, ['cs2-2']);
});

test('syncs instances sequentially, never in parallel', async () => {
  let active = 0;
  let maxActive = 0;
  await syncInstances({
    servers: [{ name: 'cs2-1' }, { name: 'cs2-2' }, { name: 'cs2-3' }],
    deep: true,
    sync: async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 10));
      active -= 1;
    },
    verify: async () => {},
  });
  assert.equal(maxActive, 1);
});

test('keeps the systemd non-blocking updater lock', () => {
  const unit = readFileSync(new URL('./duelplay-cs2-update.service', import.meta.url), 'utf8');
  assert.match(unit, /\/usr\/bin\/flock --nonblock /);
  assert.equal((unit.match(/^ExecStart=/gm) ?? []).length, 1);
});

test('keeps the required control-file integrity set', () => {
  assert.deepEqual([...CONTROL_FILES].sort(), [
    'bin/linuxsteamrt64/cs2',
    'bin/linuxsteamrt64/libengine2.so',
    'csgo/steam.inf',
  ]);
});
