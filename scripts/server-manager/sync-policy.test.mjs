import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CONTROL_FILES,
  isDeepVerifyDay,
  parseSteamPublicBuildId,
  selectUpdateAction,
  selectSyncMode,
  syncInstances,
} from './sync-policy.mjs';

const MONDAY = new Date('2026-10-19T02:00:00.000Z');
const SUNDAY = new Date('2026-10-18T02:00:00.000Z');
const VALID_STATE = {
  lastSuccessful: { result: 'SUCCEEDED', buildId: '26144732' },
  lastAttempt: { result: 'SUCCEEDED' },
};

test('parses the current Build ID only from Steam app metadata public branch', () => {
  assert.equal(parseSteamPublicBuildId('"branches" { "public" { "buildid" "26144732" } }'), '26144732');
  assert.equal(parseSteamPublicBuildId('"branches" { "beta" { "buildid" "26144733" } }'), null);
  assert.equal(parseSteamPublicBuildId('unavailable'), null);
});

test('same current Build ID with confirmed successful state and synchronized instances skips update and sync', () => {
  const plan = selectUpdateAction({
    latestBuildId: '26144732',
    installedBuildId: '26144732',
    previousStatus: 'SUCCEEDED',
    state: VALID_STATE,
    sharedIntegrityVerified: true,
    instancesSynced: true,
    now: MONDAY,
  });
  assert.equal(plan.action, 'SKIP');
  assert.equal(plan.runSteamCmd, false);
  assert.equal(plan.runSync, false);
});

test('a changed Build ID starts SteamCMD validation and deep synchronization', () => {
  const plan = selectUpdateAction({
    latestBuildId: '26144733',
    installedBuildId: '26144732',
    previousStatus: 'SUCCEEDED',
    state: VALID_STATE,
    sharedIntegrityVerified: true,
    instancesSynced: true,
  });
  assert.equal(plan.action, 'UPDATE');
  assert.equal(plan.runSteamCmd, true);
  assert.equal(plan.runSync, true);
  assert.equal(plan.deep, true);
});

test('failed or unknown prior state requires full recovery and cannot skip', () => {
  for (const previousStatus of ['FAILED', 'RUNNING', null, 'UNKNOWN']) {
    const plan = selectUpdateAction({
      latestBuildId: '26144732',
      installedBuildId: '26144732',
      previousStatus,
      state: VALID_STATE,
      sharedIntegrityVerified: true,
      instancesSynced: true,
    });
    assert.equal(plan.action, 'RECOVERY', String(previousStatus));
    assert.equal(plan.runSteamCmd, true);
    assert.equal(plan.deep, true);
  }
});

test('one unsynchronized instance triggers group synchronization rather than success', () => {
  const plan = selectUpdateAction({
    latestBuildId: '26144732',
    installedBuildId: '26144732',
    previousStatus: 'SUCCEEDED',
    state: VALID_STATE,
    sharedIntegrityVerified: true,
    instancesSynced: false,
  });
  assert.equal(plan.action, 'SYNC');
  assert.equal(plan.runSteamCmd, false);
  assert.equal(plan.runSync, true);
});

test('forced or scheduled deep verification does not imply an app download', () => {
  const forcedPlan = selectUpdateAction({
    latestBuildId: '26144732',
    installedBuildId: '26144732',
    previousStatus: 'SUCCEEDED',
    state: VALID_STATE,
    sharedIntegrityVerified: true,
    instancesSynced: true,
    forceDeep: true,
  });
  assert.equal(forcedPlan.action, 'VERIFY');
  assert.equal(forcedPlan.runSteamCmd, false);
  assert.equal(forcedPlan.deep, true);

  const scheduledPlan = selectUpdateAction({
    latestBuildId: '26144732',
    installedBuildId: '26144732',
    previousStatus: 'SUCCEEDED',
    state: VALID_STATE,
    sharedIntegrityVerified: true,
    instancesSynced: true,
    scheduledDeep: true,
  });
  assert.equal(scheduledPlan.action, 'VERIFY');
  assert.equal(scheduledPlan.runSteamCmd, false);
  assert.equal(scheduledPlan.deep, true);
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
    /full checksum synchronization did not verify: hash mismatch/,
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
    /cs2-2: full checksum synchronization did not verify/,
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
