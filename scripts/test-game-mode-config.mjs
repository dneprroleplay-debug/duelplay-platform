import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_GAME_MODE_CONFIG,
  GAME_MODE_CONTROLLER_VERSION,
  GAME_MODE_CONFIG_SERVER_NAMES,
  GAME_MODE_IDS,
  LEGACY_COMPAT_GAME_MODE_CONFIG,
  REQUIRED_GAME_MODE_CONTROLLER_CAPABILITIES,
  allConfigServersAcknowledged,
  gameModeConfigChecksum,
  modeIsAvailable,
  snapshotForMatch,
  validateGameModeConfig,
} from '../lib/game-mode-config.mjs';

const MAPS = [
  'aim_redline', 'aim_dust2', 'pool_day', 'one_v_one_aim_map', 'minecraft_aim_map',
  'aim_cache', 'fy_snow', 'one_vs_one_aim_map_arena', 'one_v_one_anubis_aim', 'aim_halloween_1v1',
];

test('defaults include exactly the ten catalog game modes and preserve eight existing modes', () => {
  assert.equal(GAME_MODE_IDS.length, 10);
  assert.deepEqual(Object.keys(DEFAULT_GAME_MODE_CONFIG.modes), [...GAME_MODE_IDS]);
  for (const mode of GAME_MODE_IDS.slice(0, 8)) assert.equal(DEFAULT_GAME_MODE_CONFIG.modes[mode].enabled, true);
  assert.equal(DEFAULT_GAME_MODE_CONFIG.modes.LOW_GRAVITY.enabled, false);
  assert.equal(DEFAULT_GAME_MODE_CONFIG.modes.SPEED_DUEL.enabled, false);
  assert.equal(DEFAULT_GAME_MODE_CONFIG.modes.GRENADE_ONLY.settings.replenishmentMode, 'COOLDOWN');
  assert.equal(LEGACY_COMPAT_GAME_MODE_CONFIG.modes.GRENADE_ONLY.settings.replenishmentMode, 'ROUND_QUOTA');
  assert.equal(LEGACY_COMPAT_GAME_MODE_CONFIG.modes.GRENADE_ONLY.settings.grenades.find(grenade => grenade.type === 'HE').count, 3);
});

test('configuration accepts supported bounds and preserves every map in the existing catalog', () => {
  const result = validateGameModeConfig(DEFAULT_GAME_MODE_CONFIG, { mapIds: MAPS });
  assert.equal(result.ok, true);
  assert.equal(result.value.modes.SOLO_1V1.allowedMapIds, null);
  assert.equal(modeIsAvailable(result.value, 'SOLO_1V1', 'aim_redline'), true);
  assert.equal(modeIsAvailable(result.value, 'LOW_GRAVITY', 'aim_redline'), false);
});

test('rejects unknown modes, duplicate/unknown maps and invalid numeric ranges', () => {
  const invalid = structuredClone(DEFAULT_GAME_MODE_CONFIG);
  invalid.modes.EXTRA_MODE = { enabled: true, allowedMapIds: null, settings: {} };
  invalid.modes.SPEED_DUEL.enabled = true;
  invalid.modes.SPEED_DUEL.settings.speedPercent = 240;
  invalid.modes.SOLO_1V1.allowedMapIds = ['aim_redline', 'aim_redline', 'not-a-map'];
  const result = validateGameModeConfig(invalid, { mapIds: MAPS });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(item => item.path === 'modes' && /unknown mode/.test(item.message)));
  assert.ok(result.errors.some(item => item.path === 'modes.SPEED_DUEL.settings.speedPercent'));
  assert.ok(result.errors.some(item => item.path === 'modes.SOLO_1V1.allowedMapIds'));
});

test('Low Gravity cannot be enabled on maps without a verified server-derived safety profile', () => {
  const config = structuredClone(DEFAULT_GAME_MODE_CONFIG);
  config.modes.LOW_GRAVITY.enabled = true;
  config.modes.LOW_GRAVITY.allowedMapIds = ['aim_redline', 'fy_snow'];
  const unverified = validateGameModeConfig(config, { mapIds: MAPS, mapSafetyProfiles: {} });
  assert.equal(unverified.ok, false);
  assert.equal(unverified.errors.filter(item => item.path.startsWith('modes.LOW_GRAVITY.allowedMapIds.')).length, 2);

  const verified = validateGameModeConfig(config, {
    mapIds: MAPS,
    mapSafetyProfiles: {
      aim_redline: { verified: true, minimumSafeGravityPercent: 50 },
      fy_snow: { verified: true, minimumSafeGravityPercent: 60 },
    },
  });
  assert.equal(verified.ok, true);
});

test('Low Gravity rejects a gravity setting more extreme than the map profile allows', () => {
  const config = structuredClone(DEFAULT_GAME_MODE_CONFIG);
  config.modes.LOW_GRAVITY.enabled = true;
  config.modes.LOW_GRAVITY.allowedMapIds = ['fy_snow'];
  config.modes.LOW_GRAVITY.settings.gravityPercent = 40;
  const result = validateGameModeConfig(config, { mapIds: MAPS, mapSafetyProfiles: { fy_snow: { verified: true, minimumSafeGravityPercent: 60 } } });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(item => item.path.includes('gravityPercentByMap.fy_snow')));
});

test('Grenade Only validates supported types, per-type amounts, and bounded independent cooldowns', () => {
  const config = structuredClone(DEFAULT_GAME_MODE_CONFIG);
  config.modes.GRENADE_ONLY.settings.grenades.find(grenade => grenade.type === 'DECOY').enabled = true;
  config.modes.GRENADE_ONLY.settings.grenades.find(grenade => grenade.type === 'DECOY').cooldownSeconds = 2;
  const valid = validateGameModeConfig(config, { mapIds: MAPS });
  assert.equal(valid.ok, true);

  config.modes.GRENADE_ONLY.settings.grenades.push({ type: 'UNKNOWN', count: 1, enabled: true, cooldownSeconds: 0 });
  const invalid = validateGameModeConfig(config, { mapIds: MAPS });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some(item => item.path === 'modes.GRENADE_ONLY.settings.grenades'));
});

test('match snapshots are isolated from later edits and checksum is stable across object key order', () => {
  const config = validateGameModeConfig(DEFAULT_GAME_MODE_CONFIG, { mapIds: MAPS });
  assert.equal(config.ok, true);
  const snapshot = snapshotForMatch(config.value, 'SOLO_1V1', 'aim_redline');
  config.value.modes.SOLO_1V1.settings.maxRounds = 3;
  assert.equal(snapshot.mode.settings.maxRounds, 13);
  assert.equal(gameModeConfigChecksum({ b: 2, a: 1 }), gameModeConfigChecksum({ a: 1, b: 2 }));
});

test('a configuration is not synchronized until all three servers stage the same checksum', () => {
  const checksum = 'a'.repeat(64);
  const allAcks = GAME_MODE_CONFIG_SERVER_NAMES.map(serverName => ({ serverName, checksum, status: 'STAGED', modeControllerVersion: GAME_MODE_CONTROLLER_VERSION, capabilities: [...REQUIRED_GAME_MODE_CONTROLLER_CAPABILITIES] }));
  assert.equal(allConfigServersAcknowledged(allAcks, checksum), true);
  assert.equal(allConfigServersAcknowledged(allAcks.slice(0, 2), checksum), false);
  assert.equal(allConfigServersAcknowledged(allAcks.map(ack => ack.serverName === 'cs2-3' ? { ...ack, checksum: 'b'.repeat(64) } : ack), checksum), false);
  assert.equal(allConfigServersAcknowledged(allAcks.map(ack => ack.serverName === 'cs2-2' ? { ...ack, status: 'PENDING' } : ack), checksum), false);
  assert.equal(allConfigServersAcknowledged(allAcks.map(ack => ack.serverName === 'cs2-3' ? { ...ack, modeControllerVersion: '0.9.0' } : ack), checksum), false);
  assert.equal(allConfigServersAcknowledged(allAcks.map(ack => ack.serverName === 'cs2-3' ? { ...ack, capabilities: ['BASE_CONFIG'] } : ack), checksum), false);
});
