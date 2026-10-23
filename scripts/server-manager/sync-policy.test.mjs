import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CONTROL_FILES,
  isDeepVerifyDay,
  selectSyncMode,
  syncInstances,
} from './sync-policy.mjs';

const MONDAY = new Date('2026-10-19T02:00:00.000Z');
const SUNDAY = new Date('2026-10-18T02:00:00.000Z');

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
