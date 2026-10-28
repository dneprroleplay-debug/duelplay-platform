/**
 * Verified Low Gravity map-safety policy.
 *
 * Policy DUELPLAY_LOW_GRAVITY_V1:
 * - 60% is the lowest approved Low Gravity preset (the product default).
 * - Lower presets (20/40/50) remain selectable in the editor only so the
 *   validator can return a precise UNSAFE_GRAVITY_SETTINGS error; they are not
 *   approved for publication on any duel map.
 * - Every map in DUEL_MAPS is covered by the same reviewed policy. A map
 *   without an entry fails closed with SAFETY_PROFILE_REQUIRED.
 *
 * This is a policy verification, not a runtime geometry probe. It is the
 * trusted source consumed by admin validation, the server-manager config API,
 * the public availability API, and matchmaking.
 */
export const MINIMUM_SAFE_GRAVITY_PERCENT = 60;
export const LOW_GRAVITY_SAFETY_POLICY_VERSION = 'DUELPLAY_LOW_GRAVITY_V1';
export const LOW_GRAVITY_SAFETY_VERIFIED_AT = '2026-10-28';

const DUEL_MAP_IDS = Object.freeze([
  'aim_redline',
  'aim_dust2',
  'pool_day',
  'one_v_one_aim_map',
  'minecraft_aim_map',
  'aim_cache',
  'fy_snow',
  'one_vs_one_aim_map_arena',
  'one_v_one_anubis_aim',
  'aim_halloween_1v1',
]);

const POLICY_NOTE = 'Policy minimum is the product default 60%; lower presets are not approved.';

function createProfile(mapId) {
  return Object.freeze({
    mapId,
    verified: true,
    minimumSafeGravityPercent: MINIMUM_SAFE_GRAVITY_PERCENT,
    policyVersion: LOW_GRAVITY_SAFETY_POLICY_VERSION,
    verifiedAt: LOW_GRAVITY_SAFETY_VERIFIED_AT,
    method: 'APPROVED_LOW_GRAVITY_POLICY',
    note: POLICY_NOTE,
  });
}

const PROFILES = Object.freeze(Object.fromEntries(DUEL_MAP_IDS.map(mapId => [mapId, createProfile(mapId)])));

/** Returns a fresh profile map so callers cannot mutate the shared policy. */
export function getMapSafetyProfiles() {
  return Object.fromEntries(Object.entries(PROFILES).map(([mapId, profile]) => [mapId, { ...profile }]));
}

/** Returns the profile list expected by the admin UI. */
export function getMapSafetyProfileList() {
  return Object.values(PROFILES).map(profile => ({ ...profile }));
}

export function getMapSafetyProfile(mapId) {
  const profile = PROFILES[mapId];
  return profile ? { ...profile } : null;
}

export function isMapSafetyProfileVerified(mapId) {
  return PROFILES[mapId]?.verified === true;
}
