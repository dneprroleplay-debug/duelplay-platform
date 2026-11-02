import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync, unlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUpdaterSyncMarkerController } from '../lib/cs2-update-sync-marker.mjs';
import { isLegacyCs2UpdaterMarkerContent } from '../lib/cs2-update-recovery.mjs';

const tempRoot = mkdtempSync(join(tmpdir(), 'duelplay-sync-marker-owner-'));
let passed = 0;

function test(name, run) {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
}

function withMarkerPath(run) {
  const directory = join(tempRoot, `case-${passed + 1}`);
  mkdirSync(directory, { recursive: true });
  return run(join(directory, '.duelplay-sync-in-progress'));
}

function writeForeignMarker(markerPath, { pid = 987654321, startedAt = '2020-01-01T00:00:00.000Z' } = {}) {
  const content = JSON.stringify({ pid, startedAt });
  writeFileSync(markerPath, content, { mode: 0o600, flag: 'wx' });
  return { content, identity: statSync(markerPath) };
}

function assertUnchanged(markerPath, expected) {
  assert.equal(readFileSync(markerPath, 'utf8'), expected.content);
  const actual = statSync(markerPath);
  assert.equal(actual.dev, expected.identity.dev);
  assert.equal(actual.ino, expected.identity.ino);
  assert.equal(actual.size, expected.identity.size);
}

try {
  test('foreign stale legacy marker is not overwritten by begin()', () => withMarkerPath(markerPath => {
    const foreign = writeForeignMarker(markerPath);
    const controller = createUpdaterSyncMarkerController(markerPath, {
      pid: 12345,
      now: () => new Date('2026-10-29T12:00:00.000Z'),
    });
    assert.throws(() => controller.begin(), error => error.code === 'SYNC_MARKER_OWNERSHIP_MISMATCH');
    assertUnchanged(markerPath, foreign);
  }));

  test('foreign marker is not removed by clear()', () => withMarkerPath(markerPath => {
    const foreign = writeForeignMarker(markerPath);
    const controller = createUpdaterSyncMarkerController(markerPath, { pid: 12345 });
    assert.throws(() => controller.clear(), error => error.code === 'SYNC_MARKER_OWNERSHIP_MISMATCH');
    assertUnchanged(markerPath, foreign);
  }));

  test('updater-created marker keeps legacy { pid, startedAt } format and clears normally', () => withMarkerPath(markerPath => {
    const controller = createUpdaterSyncMarkerController(markerPath, {
      pid: 12345,
      now: () => new Date('2026-10-29T12:00:00.000Z'),
    });
    assert.equal(controller.begin(), 'CREATED');
    const content = JSON.parse(readFileSync(markerPath, 'utf8'));
    assert.deepEqual(Object.keys(content).sort(), ['pid', 'startedAt']);
    assert.equal(content.pid, 12345);
    assert.equal(isLegacyCs2UpdaterMarkerContent(content), true);
    assert.equal(controller.clear(), 'REMOVED');
    assert.throws(() => readFileSync(markerPath, 'utf8'), error => error.code === 'ENOENT');
  }));

  test('ownership mismatch after marker replacement aborts clear and begin without touching replacement', () => withMarkerPath(markerPath => {
    const controller = createUpdaterSyncMarkerController(markerPath, {
      pid: 12345,
      now: () => new Date('2026-10-29T12:00:00.000Z'),
    });
    assert.equal(controller.begin(), 'CREATED');
    unlinkSync(markerPath);
    const foreign = writeForeignMarker(markerPath, {
      pid: 54321,
      startedAt: '2026-10-29T11:00:00.000Z',
    });
    assert.throws(() => controller.assertOwned(), error => error.code === 'SYNC_MARKER_OWNERSHIP_MISMATCH');
    assert.throws(() => controller.clear(), error => error.code === 'SYNC_MARKER_OWNERSHIP_MISMATCH');
    assert.throws(() => controller.begin(), error => error.code === 'SYNC_MARKER_OWNERSHIP_MISMATCH');
    assertUnchanged(markerPath, foreign);
  }));

  console.log(`\nCS2 updater sync marker ownership tests: ${passed} passed, 0 failed (${passed} total)`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
