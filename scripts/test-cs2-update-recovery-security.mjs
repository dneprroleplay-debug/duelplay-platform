import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  assertCs2RecoveryMarkerForPhase,
  cs2RecoveryIdForRun,
  CS2_RECOVERY_MARKER_MAX_AGE_MS,
} from '../lib/cs2-update-recovery.mjs';
import { createMarkerAdapter } from '../lib/cs2-update-recovery-marker.mjs';

const RUN_ID = '5b6a8e7c-4d3f-4a2b-9c1d-123456789abc';
const RECOVERY_ID = cs2RecoveryIdForRun(RUN_ID);
const NOW = Date.parse('2026-10-29T13:15:00.000Z');
const OLD_MTIME = NOW - CS2_RECOVERY_MARKER_MAX_AGE_MS - 60_000;
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const scriptPath = path.join(root, 'scripts/server-manager/recover-cs2-update-state.mjs');
const updateAllPath = path.join(root, 'scripts/server-manager/update-all.mjs');
const helperPath = path.join(root, 'lib/cs2-update-recovery-lock.mjs');
const markerAdapterPath = path.join(root, 'lib/cs2-update-recovery-marker.mjs');
const apiRoutePath = path.join(root, 'app/api/server-manager/update-recovery/route.ts');
const results = [];

function skip(name, reason) {
  results.push({ name, status: 'SKIP', reason });
  console.log(`SKIP ${name}: ${reason}`);
}

const flockCheck = process.platform === 'linux'
  ? spawnSync('flock', ['--version'], { encoding: 'utf8' })
  : null;
const canTestKernelFlock = process.platform === 'linux' && !flockCheck?.error && flockCheck?.status === 0;

async function test(name, fn) {
  try {
    await fn();
    results.push({ name, status: 'PASS' });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: 'FAIL', error });
    console.error(`FAIL ${name}`);
    console.error(error);
  }
}

function legacyMarker(overrides = {}) {
  return {
    dev: 1,
    ino: 444,
    mtimeMs: OLD_MTIME,
    size: 80,
    content: {
      pid: 3177636,
      startedAt: new Date(OLD_MTIME).toISOString(),
      ...overrides,
    },
  };
}

function spawnWorker(workerPath, lockPath, holdMs) {
  return spawn(process.execPath, [workerPath], {
    env: { ...process.env, TEST_LOCK_PATH: lockPath, TEST_HOLD_MS: String(holdMs) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function waitForText(child, text, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${text}; got: ${output}`)), timeoutMs);
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      if (output.includes(text)) {
        clearTimeout(timeout);
        resolve(output);
      }
    });
    child.stderr.on('data', chunk => { output += chunk.toString(); });
    child.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', code => {
      if (!output.includes(text)) {
        clearTimeout(timeout);
        reject(new Error(`Worker exited ${code} before ${text}; output: ${output}`));
      }
    });
  });
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

await test('legacy updater marker requires exact { pid, startedAt } provenance', async () => {
  assert.equal(
    assertCs2RecoveryMarkerForPhase({
      marker: legacyMarker(), phase: 'NOT_STARTED', recoveryId: RECOVERY_ID,
      nowMs: NOW, pidIsAlive: () => false,
    }),
    'STALE_ORIGINAL_MARKER',
  );
});

await test('rejects stale marker with unknown source', async () => {
  assert.throws(() => assertCs2RecoveryMarkerForPhase({
    marker: legacyMarker({ source: 'unknown-updater' }), phase: 'NOT_STARTED',
    recoveryId: RECOVERY_ID, nowMs: NOW, pidIsAlive: () => false,
  }), /SYNC_MARKER_ORIGIN_INVALID/);
});

await test('rejects stale marker carrying a foreign recoveryId', async () => {
  assert.throws(() => assertCs2RecoveryMarkerForPhase({
    marker: legacyMarker({ recoveryId: 'cs2-update-recovery-v1:foreign' }),
    phase: 'PREPARED', recoveryId: RECOVERY_ID, nowMs: NOW, pidIsAlive: () => false,
  }), /SYNC_MARKER_ORIGIN_INVALID/);
});

await test('rejects a marker with the correct predictable recovery ID but a foreign ownership token', async () => {
  assert.throws(() => assertCs2RecoveryMarkerForPhase({
    marker: legacyMarker({
      source: 'duelplay-controlled-recovery',
      recoveryId: RECOVERY_ID,
      ownershipToken: 'cc'.repeat(32),
    }),
    phase: 'PREPARED', recoveryId: RECOVERY_ID,
    ownershipToken: 'dd'.repeat(32), nowMs: NOW, pidIsAlive: () => false,
  }), /SYNC_MARKER_ORIGIN_INVALID/);
});

await test('rejects marker of another type despite stale timestamp and dead PID', async () => {
  assert.throws(() => assertCs2RecoveryMarkerForPhase({
    marker: legacyMarker({ type: 'some-other-lock', owner: 'deploy-tool' }),
    phase: 'NOT_STARTED', recoveryId: RECOVERY_ID, nowMs: NOW, pidIsAlive: () => false,
  }), /SYNC_MARKER_ORIGIN_INVALID/);
});

await test('marker adapter refuses to replace or delete foreign marker content', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duelplay-marker-safety-'));
  const markerPath = path.join(dir, '.duelplay-sync-in-progress');
  const foreign = { type: 'other-operation', source: 'unknown-tool', recoveryId: 'other', pid: 901, startedAt: new Date(OLD_MTIME).toISOString() };
  fs.writeFileSync(markerPath, JSON.stringify(foreign), { mode: 0o600 });
  const adapter = createMarkerAdapter(markerPath, { now: () => NOW, pidIsAlive: () => false });
  const before = adapter.read();
  const ownedContent = { source: 'duelplay-controlled-recovery', recoveryId: RECOVERY_ID, ownershipToken: 'dd'.repeat(32), pid: process.pid, startedAt: new Date(NOW).toISOString() };
  assert.throws(() => adapter.writeRecoveryMarker(ownedContent, before), /SYNC_MARKER_OWNERSHIP_MISMATCH/);
  assert.throws(() => adapter.removeOwnedRecoveryMarker(RECOVERY_ID, ownedContent.ownershipToken), /SYNC_MARKER_OWNERSHIP_MISMATCH/);
  assert.deepEqual(JSON.parse(fs.readFileSync(markerPath, 'utf8')), foreign);
  fs.rmSync(dir, { recursive: true, force: true });
});

if (canTestKernelFlock) {
  await test('marker adapter refuses same recovery ID with a nonmatching ownership token', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duelplay-marker-token-'));
  const markerPath = path.join(dir, '.duelplay-sync-in-progress');
  const foreign = {
    source: 'duelplay-controlled-recovery', recoveryId: RECOVERY_ID,
    ownershipToken: 'cc'.repeat(32), pid: process.pid, startedAt: new Date(NOW).toISOString(),
  };
  fs.writeFileSync(markerPath, JSON.stringify(foreign), { mode: 0o600 });
  const adapter = createMarkerAdapter(markerPath, { now: () => NOW, pidIsAlive: () => false });
  const before = adapter.read();
  const expected = { ...foreign, ownershipToken: 'dd'.repeat(32) };
  assert.throws(() => adapter.writeRecoveryMarker(expected, before), /SYNC_MARKER_OWNERSHIP_MISMATCH/);
  assert.throws(() => adapter.removeOwnedRecoveryMarker(RECOVERY_ID, expected.ownershipToken), /SYNC_MARKER_OWNERSHIP_MISMATCH/);
  assert.deepEqual(JSON.parse(fs.readFileSync(markerPath, 'utf8')), foreign);
  fs.rmSync(dir, { recursive: true, force: true });
});

await test('two parallel processes cannot remove one another lock or enter critical section together', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duelplay-flock-race-'));
  const lockPath = path.join(dir, '.duelplay-cs2-controlled-recovery.lock');
  const workerPath = path.join(dir, 'lock-worker.mjs');
  fs.writeFileSync(lockPath, JSON.stringify({
    pid: 99999999, runId: RUN_ID, ownerToken: 'stale-legacy-owner',
    startedAt: new Date(OLD_MTIME).toISOString(),
  }), { mode: 0o600 });
  const initialLockStat = fs.statSync(lockPath);
  fs.writeFileSync(workerPath, `
    import { enterFlockOrRelaunch } from ${JSON.stringify(pathToFileURL(helperPath).href)};
    const gate = enterFlockOrRelaunch({ lockPath: process.env.TEST_LOCK_PATH, scriptPath: process.argv[1] });
    if (!gate.isChild) {
      if (gate.error) console.error(gate.error);
      process.exit(gate.exitCode);
    }
    console.log('LOCK_CHILD_STARTED');
    await new Promise(resolve => setTimeout(resolve, Number(process.env.TEST_HOLD_MS || 250)));
  `, 'utf8');

  const first = spawnWorker(workerPath, lockPath, 450);
  await waitForText(first, 'LOCK_CHILD_STARTED');
  const second = spawnWorker(workerPath, lockPath, 20);
  const secondExit = await waitForExit(second);
  assert.equal(secondExit.code, 75, `second process should exit with lock conflict 75; got ${JSON.stringify(secondExit)}`);
  const firstExit = await waitForExit(first);
  assert.deepEqual(firstExit, { code: 0, signal: null });
  assert.equal(fs.existsSync(lockPath), true, 'stable lock inode must not be unlinked by either process');
  assert.equal(fs.statSync(lockPath).ino, initialLockStat.ino, 'stale-lock recovery must retain the same inode');
  const lockMeta = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  assert.equal(lockMeta.protocol, 'flock-v1');

  const third = spawnWorker(workerPath, lockPath, 10);
  const thirdOutput = await waitForText(third, 'LOCK_CHILD_STARTED');
  assert.match(thirdOutput, /LOCK_CHILD_STARTED/);
  assert.deepEqual(await waitForExit(third), { code: 0, signal: null });
  assert.equal(fs.existsSync(lockPath), true);
  fs.rmSync(dir, { recursive: true, force: true });
  });
} else {
  skip(
    'two parallel processes cannot remove one another lock or enter critical section together',
    'requires Linux util-linux flock and /proc/locks; lock implementation is Linux-specific, so this runtime cannot execute the kernel-lock integration test.'
  );
}

await test('an active legacy lock owner fails closed without altering its lock record', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duelplay-flock-legacy-live-'));
  const lockPath = path.join(dir, '.duelplay-cs2-controlled-recovery.lock');
  const workerPath = path.join(dir, 'lock-worker.mjs');
  const legacyRecord = {
    pid: process.pid, runId: RUN_ID, ownerToken: 'legacy-active-owner',
    startedAt: new Date(NOW).toISOString(),
  };
  fs.writeFileSync(lockPath, JSON.stringify(legacyRecord), { mode: 0o600 });
  const originalStat = fs.statSync(lockPath);
  fs.writeFileSync(workerPath, `
    import { enterFlockOrRelaunch } from ${JSON.stringify(pathToFileURL(helperPath).href)};
    const gate = enterFlockOrRelaunch({ lockPath: process.env.TEST_LOCK_PATH, scriptPath: process.argv[1] });
    if (!gate.isChild) process.exit(gate.exitCode);
    process.exit(0);
  `, 'utf8');
  const worker = spawnWorker(workerPath, lockPath, 1);
  const result = await waitForExit(worker);
  assert.notEqual(result.code, 0, 'live legacy owner must block acquisition');
  assert.equal(fs.statSync(lockPath).ino, originalStat.ino, 'active legacy lock inode must not be replaced');
  assert.deepEqual(JSON.parse(fs.readFileSync(lockPath, 'utf8')), legacyRecord, 'active legacy metadata must remain unchanged');
  fs.rmSync(dir, { recursive: true, force: true });
});

await test('both updater and recovery take the same stable flock before side effects', async () => {
  const recovery = fs.readFileSync(scriptPath, 'utf8');
  const updateAll = fs.readFileSync(updateAllPath, 'utf8');
  assert.match(recovery, /enterFlockOrRelaunch/);
  assert.match(updateAll, /enterFlockOrRelaunch/);
  assert.match(recovery, /\.duelplay-cs2-controlled-recovery\.lock/);
  assert.match(updateAll, /\.duelplay-cs2-controlled-recovery\.lock/);
  const lockHelper = fs.readFileSync(helperPath, 'utf8');
  assert.match(lockHelper, /'flock'/);
  assert.match(lockHelper, /CS2_FLOCK_CONFLICT_EXIT = 75/);
  assert.doesNotMatch(lockHelper, /unlinkSync\(lockPath\)/);
});

await test('marker replacement and deletion are documented as relying on shared flock, not rereads alone', async () => {
  const marker = fs.readFileSync(markerAdapterPath, 'utf8');
  assert.match(marker, /same kernel flock for their full lifetime/);
  assert.match(marker, /fs\.linkSync\(tempPath, markerPath\)/, 'create must not replace a path that appeared concurrently');
  assert.match(marker, /sameMarkerIdentity\(latest, expectedMarker\)/);
  assert.match(marker, /isCs2RecoveryMarker\(current, recoveryId, ownershipToken\)/);
});

await test('recovery executor rejects active cs2.sh launcher and does not run updater or game', async () => {
  const recovery = fs.readFileSync(scriptPath, 'utf8');
  assert.match(recovery, /label: 'cs2\.sh launcher', args: \['-af', 'cs2\[\.\]sh'\]/);
  assert.match(recovery, /args: \['-af', 'update-all\[\.\]mjs'\]/);
  assert.doesNotMatch(recovery, /\+app_update/);
  assert.doesNotMatch(recovery, /STEAMCMD_BIN/);
  assert.doesNotMatch(recovery, /spawnSync\(['"](cs2|cs2_linux64|srcds_linux|cs2\.sh)/);
});

await test('finalization requires a fresh signed receipt bound to nonce, recovery ID, phase and recorded inode', async () => {
  const route = fs.readFileSync(apiRoutePath, 'utf8');
  assert.match(route, /isFreshServerManagerRequest\(request\)/);
  assert.match(route, /markerCleanupNonce: randomBytes\(32\)\.toString\("hex"\)/);
  assert.match(route, /markerReceiptMatchesLedger\(receipt, existing, now\.getTime\(\)\)/);
  assert.match(route, /receipt\.phase === "STATUS_UPDATED"/);
  assert.match(route, /receipt\.marker\.ino === ledger\.markerIno/);
  assert.match(route, /receipt\.nonce === ledger\.markerCleanupNonce/);
  assert.match(route, /receipt\.disposition/);
  assert.doesNotMatch(route, /if \(action === "finalize" && body\.markerAbsent !== true\)/);
});

const passed = results.filter(item => item.status === 'PASS').length;
const failed = results.filter(item => item.status === 'FAIL');
const skipped = results.filter(item => item.status === 'SKIP').length;
console.log(`\nCS2 recovery security tests: ${passed} passed, ${failed.length} failed, ${skipped} skipped (${results.length} total)`);
if (failed.length) process.exitCode = 1;
