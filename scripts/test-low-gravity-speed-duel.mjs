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

test('LOW_GRAVITY applies map-specific 60% over general 70%', () => {
  const value = extractMatchModeSettings('LOW_GRAVITY', snapshot('LOW_GRAVITY', mapId, {
    gravityPercent: 70,
    gravityPercentByMap: { [mapId]: 60 },
  }), mapId);
  assert.deepEqual(value, { gravityPercent: 60 });
});

test('LOW_GRAVITY uses the general gravity when this map has no override', () => {
  const value = extractMatchModeSettings('LOW_GRAVITY', snapshot('LOW_GRAVITY', mapId, {
    gravityPercent: 60,
    gravityPercentByMap: { aim_cache: 70 },
  }), mapId);
  assert.deepEqual(value, { gravityPercent: 60 });
});

test('LOW_GRAVITY rejects gravity below the approved 60% policy floor', () => {
  for (const unsafe of [20, 40, 50]) {
    assert.throws(() => extractMatchModeSettings('LOW_GRAVITY', snapshot('LOW_GRAVITY', mapId, {
      gravityPercent: unsafe,
    }), mapId), { message: 'MODE_CONFIG_UNAVAILABLE' });
    assert.throws(() => extractMatchModeSettings('LOW_GRAVITY', snapshot('LOW_GRAVITY', mapId, {
      gravityPercent: 70,
      gravityPercentByMap: { [mapId]: unsafe },
    }), mapId), { message: 'MODE_CONFIG_UNAVAILABLE' });
  }
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
  assert.match(manager, /writeModeConfigFiles\(mode, modeSettings, \{[\s\S]*?mapId: claimed\.mapId[\s\S]*?version: claimed\.modeConfigSnapshot\?\.version[\s\S]*?checksum: claimed\.modeConfigSnapshot\?\.checksum[\s\S]*?\}\);\s*const child = spawn\(CS2_SCRIPT/);
  assert.match(manager, /MODE_CONFIG_MATCH_FILE = join\(MODE_CONFIG_DIR, 'duelplay-match-mode\.json'\)/);
  assert.match(manager, /writeJsonAtomically\(MODE_CONFIG_MATCH_FILE/);
  assert.match(manager, /acknowledgeModeConfig\(payload, 'APPLIED', controller\)/);
  assert.match(manager, /function resetModeConfigs\(\)/);
  assert.match(manager, /resetModeConfigs\(\);/);
  assert.match(manager, /const speed = Math\.round\(320 \* speedPercent \/ 100\)/);
  assert.match(manager, /sv_maxspeed \$\{speed\}/);
  assert.match(manager, /command\('sv_maxspeed 320'\)/);
  assert.match(manager, /sv_accelerate_use_weapon_speed \$\{weaponSpeedScale\}/);
  assert.match(manager, /command\('sv_accelerate_use_weapon_speed 1'\)/);
  assert.doesNotMatch(manager, /mp_walkspeed|mp_maxspeed/, 'Speed Duel must use the CS2 sv_maxspeed convar, not legacy/unknown convars');
});
