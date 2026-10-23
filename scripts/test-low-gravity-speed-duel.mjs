import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { extractMatchModeSettings } from '../lib/game-mode-config.mjs';

const mapId = 'aim_redline';

function snapshot(modeId, currentMapId, settings) {
  return {
    schemaVersion: 1,
    version: 12,
    checksum: 'a'.repeat(64),
    modeId,
    mapId: currentMapId,
    mode: { enabled: true, settings },
  };
}

test('LOW_GRAVITY applies map-specific 50% over general 40%', () => {
  const value = extractMatchModeSettings('LOW_GRAVITY', snapshot('LOW_GRAVITY', mapId, {
    gravityPercent: 40,
    gravityPercentByMap: { [mapId]: 50 },
  }), mapId);
  assert.deepEqual(value, { gravityPercent: 50 });
});

test('LOW_GRAVITY uses the general gravity when this map has no override', () => {
  const value = extractMatchModeSettings('LOW_GRAVITY', snapshot('LOW_GRAVITY', mapId, {
    gravityPercent: 40,
    gravityPercentByMap: { aim_cache: 60 },
  }), mapId);
  assert.deepEqual(value, { gravityPercent: 40 });
});

test('SPEED_DUEL extracts supported speed 130%', () => {
  assert.deepEqual(
    extractMatchModeSettings('SPEED_DUEL', snapshot('SPEED_DUEL', mapId, { speedPercent: 130 }), mapId),
    { speedPercent: 130 },
  );
});

test('LOW_GRAVITY rejects a missing snapshot', () => {
  assert.throws(() => extractMatchModeSettings('LOW_GRAVITY', null, mapId), { message: 'MODE_CONFIG_UNAVAILABLE' });
});

test('SPEED_DUEL rejects a missing snapshot', () => {
  assert.throws(() => extractMatchModeSettings('SPEED_DUEL', undefined, mapId), { message: 'MODE_CONFIG_UNAVAILABLE' });
});

test('advanced mode rejects a snapshot for a different mode or map', () => {
  assert.throws(() => extractMatchModeSettings('LOW_GRAVITY', snapshot('SPEED_DUEL', mapId, { speedPercent: 130 }), mapId), { message: 'MODE_CONFIG_UNAVAILABLE' });
  assert.throws(() => extractMatchModeSettings('LOW_GRAVITY', snapshot('LOW_GRAVITY', 'aim_cache', { gravityPercent: 40 }), mapId), { message: 'MODE_CONFIG_UNAVAILABLE' });
});

test('LOW_GRAVITY rejects invalid general gravity 99%', () => {
  assert.throws(() => extractMatchModeSettings('LOW_GRAVITY', snapshot('LOW_GRAVITY', mapId, { gravityPercent: 99 }), mapId), { message: 'MODE_CONFIG_UNAVAILABLE' });
});

test('LOW_GRAVITY rejects invalid map-specific gravity and invalid overrides for other maps', () => {
  assert.throws(() => extractMatchModeSettings('LOW_GRAVITY', snapshot('LOW_GRAVITY', mapId, {
    gravityPercent: 40,
    gravityPercentByMap: { [mapId]: 99 },
  }), mapId), { message: 'MODE_CONFIG_UNAVAILABLE' });
  assert.throws(() => extractMatchModeSettings('LOW_GRAVITY', snapshot('LOW_GRAVITY', mapId, {
    gravityPercent: 40,
    gravityPercentByMap: { aim_cache: 99 },
  }), mapId), { message: 'MODE_CONFIG_UNAVAILABLE' });
});

test('SPEED_DUEL rejects unsupported speed', () => {
  assert.throws(() => extractMatchModeSettings('SPEED_DUEL', snapshot('SPEED_DUEL', mapId, { speedPercent: 240 }), mapId), { message: 'MODE_CONFIG_UNAVAILABLE' });
});

test('legacy modes do not require advanced settings snapshots', () => {
  assert.deepEqual(extractMatchModeSettings('SOLO_1V1', null, mapId), {});
  assert.deepEqual(extractMatchModeSettings('GRENADE_ONLY', null, mapId), {});
});

test('server manager uses the shared validator, writes configs before process start, and defines resetModeConfigs', () => {
  const manager = fs.readFileSync(new URL('./server-manager/server-manager.mjs', import.meta.url), 'utf8');
  assert.match(manager, /extractMatchModeSettings\(mode, claimed\.modeConfigSnapshot, claimed\.mapId\)/);
  assert.match(manager, /writeModeConfigFiles\(mode, modeSettings\);\s*const child = spawn\(CS2_SCRIPT/);
  assert.match(manager, /function resetModeConfigs\(\)/);
  assert.match(manager, /resetModeConfigs\(\);/);
});
