import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  DEFAULT_GAME_MODE_CONFIG,
  GAME_MODE_IDS,
  buildGameModeAvailability,
  validateGameModeConfig,
} from '../lib/game-mode-config.mjs';
import {
  indexPublicGameModeAvailability,
  isDuelModeAvailable,
} from '../lib/duel-mode-availability.mjs';
const MAPS = [
  { id: 'aim_redline', serverMapName: 'aim_redline' },
  { id: 'fy_snow', serverMapName: 'fy_snow' },
];
const catalog = MAPS.map(map => ({
  ...map,
  supportedModes: Object.fromEntries(GAME_MODE_IDS.map(mode => [mode, true])),
}));
const mapIds = catalog.map(map => map.id);

test('public availability keeps the eight legacy modes available and exposes the two gated modes', () => {
  const statuses = buildGameModeAvailability(DEFAULT_GAME_MODE_CONFIG, catalog, {});
  assert.equal(statuses.length, catalog.length);
  for (const map of statuses) {
    for (const mode of GAME_MODE_IDS.slice(0, 8)) assert.equal(map.modes[mode].available, true, `${mode} should remain available on ${map.mapId}`);
    assert.deepEqual(map.modes.LOW_GRAVITY, { available: false, reason: 'SAFETY_PROFILE_REQUIRED' });
    assert.deepEqual(map.modes.SPEED_DUEL, { available: false, reason: 'MODE_DISABLED' });
  }
});

test('Speed Duel becomes available only when the active central configuration enables and allows it', () => {
  const config = structuredClone(DEFAULT_GAME_MODE_CONFIG);
  config.modes.SPEED_DUEL.enabled = true;
  config.modes.SPEED_DUEL.allowedMapIds = ['aim_redline'];
  const result = buildGameModeAvailability(config, catalog, {});
  const redline = result.find(map => map.mapId === 'aim_redline');
  const snow = result.find(map => map.mapId === 'fy_snow');
  assert.equal(redline.modes.SPEED_DUEL.available, true);
  assert.equal(redline.modes.SPEED_DUEL.reason, null);
  assert.deepEqual(snow.modes.SPEED_DUEL, { available: false, reason: 'MAP_NOT_ALLOWED' });
});

test('Low Gravity stays locked without a verified profile even if an invalid config tries to enable it', () => {
  const config = structuredClone(DEFAULT_GAME_MODE_CONFIG);
  config.modes.LOW_GRAVITY.enabled = true;
  config.modes.LOW_GRAVITY.allowedMapIds = ['aim_redline'];
  assert.equal(validateGameModeConfig(config, { mapIds, mapSafetyProfiles: {} }).ok, false);
  const status = buildGameModeAvailability(config, catalog, {});
  assert.deepEqual(status.find(map => map.mapId === 'aim_redline').modes.LOW_GRAVITY, { available: false, reason: 'SAFETY_PROFILE_REQUIRED' });
});

test('Low Gravity is available only with a verified safe minimum and settings at or above that minimum', () => {
  const config = structuredClone(DEFAULT_GAME_MODE_CONFIG);
  config.modes.LOW_GRAVITY.enabled = true;
  config.modes.LOW_GRAVITY.allowedMapIds = ['aim_redline'];
  config.modes.LOW_GRAVITY.settings.gravityPercent = 60;
  const profiles = { aim_redline: { verified: true, minimumSafeGravityPercent: 50 } };
  assert.equal(validateGameModeConfig(config, { mapIds, mapSafetyProfiles: profiles }).ok, true);
  assert.equal(buildGameModeAvailability(config, catalog, profiles).find(map => map.mapId === 'aim_redline').modes.LOW_GRAVITY.available, true);
  config.modes.LOW_GRAVITY.settings.gravityPercent = 40;
  assert.deepEqual(buildGameModeAvailability(config, catalog, profiles).find(map => map.mapId === 'aim_redline').modes.LOW_GRAVITY, { available: false, reason: 'UNSAFE_GRAVITY_SETTINGS' });
});

test('public availability parser fails closed for advanced modes when API data is missing or malformed', () => {
  assert.equal(indexPublicGameModeAvailability(null), null);
  assert.equal(indexPublicGameModeAvailability({ ok: false, maps: [] }), null);
  assert.equal(isDuelModeAvailable(null, 'aim_redline', 'LOW_GRAVITY', true), false);
  assert.equal(isDuelModeAvailable(null, 'aim_redline', 'SPEED_DUEL', true), false);
  assert.equal(isDuelModeAvailable(null, 'aim_redline', 'SOLO_1V1', true), true);
  const indexed = indexPublicGameModeAvailability({ ok: true, maps: [{ mapId: 'aim_redline', modes: { SPEED_DUEL: { available: true, reason: null } } }] });
  assert.equal(isDuelModeAvailable(indexed, 'aim_redline', 'SPEED_DUEL', true), true);
  assert.equal(isDuelModeAvailable(indexed, 'fy_snow', 'SPEED_DUEL', true), false);
});

test('REAL, DEMO and matchmaking consume published availability and keep unavailable choices visible but disabled', () => {
  const real = readFileSync(new URL('../components/CreateMatch/CreateMatch.tsx', import.meta.url), 'utf8');
  const demo = readFileSync(new URL('../components/CreateMatch/DemoCreateMatch.tsx', import.meta.url), 'utf8');
  const matchmaking = readFileSync(new URL('../components/Matchmaking/MatchmakingPanel.tsx', import.meta.url), 'utf8');
  const matchmakingRoute = readFileSync(new URL('../app/api/matchmaking/route.ts', import.meta.url), 'utf8');
  const publicRoute = readFileSync(new URL('../app/api/game-modes/route.ts', import.meta.url), 'utf8');
  const createRoute = readFileSync(new URL('../app/api/matches/route.ts', import.meta.url), 'utf8');
  for (const source of [real, demo]) {
    assert.match(source, /loadPublicGameModeAvailability/);
    assert.match(source, /isDuelModeAvailable/);
    assert.match(source, /DUEL_MODES\.map/);
    assert.match(source, /disabled=\{!(?:available|supported)\}/);
    assert.match(source, /advancedModeAvailabilityHint/);
  }
  assert.match(matchmaking, /loadPublicGameModeAvailability/);
  assert.match(matchmaking, /isDuelModeAvailable/);
  assert.match(matchmaking, /disabled=\{!supported\}/);
  assert.match(matchmakingRoute, /buildGameModeAvailability/);
  assert.match(matchmakingRoute, /MODE_CONFIG_NOT_AVAILABLE/);
  assert.match(createRoute, /isDuelMode\(mode\)/);
  assert.match(createRoute, /buildMatchModeConfigSnapshot/);
  assert.match(createRoute, /MODE_CONFIG_NOT_AVAILABLE/);
  assert.match(publicRoute, /buildGameModeAvailability/);
  assert.match(publicRoute, /prisma\.gameModeConfigState\.findUnique/);
  assert.doesNotMatch(publicRoute, /getActiveGameModeConfig\s*\(/, 'the anonymous selector endpoint must not lazily mutate configuration state');
  assert.match(publicRoute, /Cache-Control.*no-store/);
  assert.doesNotMatch(publicRoute, /NextResponse\.json\(\s*\{[^}]*\bconfig\s*:/s, 'the public route must not expose raw mode configuration');
});
