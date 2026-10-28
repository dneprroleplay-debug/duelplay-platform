import { createHash } from 'node:crypto';
import { MINIMUM_SAFE_GRAVITY_PERCENT } from './duel-map-safety.mjs';

export const GAME_MODE_IDS = Object.freeze([
  'SOLO_1V1',
  'AWP_ONLY',
  'DEAGLE_ONLY',
  'KNIFE_ONLY',
  'HEADSHOT_ONLY',
  'RANDOM_WEAPON',
  'FIRST_TO_10',
  'GRENADE_ONLY',
  'LOW_GRAVITY',
  'SPEED_DUEL',
]);
export const GAME_MODE_CONFIG_SERVER_NAMES = Object.freeze(['cs2-1', 'cs2-2', 'cs2-3']);
export const GAME_MODE_CONTROLLER_VERSION = '1.0.0';
export const REQUIRED_GAME_MODE_CONTROLLER_CAPABILITIES = Object.freeze(['BASE_CONFIG', 'LOW_GRAVITY', 'SPEED_DUEL', 'GRENADE_COOLDOWN']);

export const RANDOM_WEAPON_CATALOG = Object.freeze([
  { weapon: 'weapon_ak47', slot: 'primary', category: 'rifles' },
  { weapon: 'weapon_m4a1', slot: 'primary', category: 'rifles' },
  { weapon: 'weapon_m4a1_silencer', slot: 'primary', category: 'rifles' },
  { weapon: 'weapon_galilar', slot: 'primary', category: 'rifles' },
  { weapon: 'weapon_famas', slot: 'primary', category: 'rifles' },
  { weapon: 'weapon_aug', slot: 'primary', category: 'rifles' },
  { weapon: 'weapon_sg556', slot: 'primary', category: 'rifles' },
  { weapon: 'weapon_awp', slot: 'primary', category: 'rifles' },
  { weapon: 'weapon_ssg08', slot: 'primary', category: 'rifles' },
  { weapon: 'weapon_g3sg1', slot: 'primary', category: 'rifles' },
  { weapon: 'weapon_scar20', slot: 'primary', category: 'rifles' },
  { weapon: 'weapon_mac10', slot: 'primary', category: 'smgs' },
  { weapon: 'weapon_mp9', slot: 'primary', category: 'smgs' },
  { weapon: 'weapon_mp7', slot: 'primary', category: 'smgs' },
  { weapon: 'weapon_mp5sd', slot: 'primary', category: 'smgs' },
  { weapon: 'weapon_ump45', slot: 'primary', category: 'smgs' },
  { weapon: 'weapon_p90', slot: 'primary', category: 'smgs' },
  { weapon: 'weapon_bizon', slot: 'primary', category: 'smgs' },
  { weapon: 'weapon_nova', slot: 'primary', category: 'heavy' },
  { weapon: 'weapon_xm1014', slot: 'primary', category: 'heavy' },
  { weapon: 'weapon_mag7', slot: 'primary', category: 'heavy' },
  { weapon: 'weapon_sawedoff', slot: 'primary', category: 'heavy' },
  { weapon: 'weapon_m249', slot: 'primary', category: 'heavy' },
  { weapon: 'weapon_negev', slot: 'primary', category: 'heavy' },
  { weapon: 'weapon_glock', slot: 'secondary', category: 'pistols' },
  { weapon: 'weapon_hkp2000', slot: 'secondary', category: 'pistols' },
  { weapon: 'weapon_usp_silencer', slot: 'secondary', category: 'pistols' },
  { weapon: 'weapon_p250', slot: 'secondary', category: 'pistols' },
  { weapon: 'weapon_tec9', slot: 'secondary', category: 'pistols' },
  { weapon: 'weapon_fiveseven', slot: 'secondary', category: 'pistols' },
  { weapon: 'weapon_cz75a', slot: 'secondary', category: 'pistols' },
  { weapon: 'weapon_deagle', slot: 'secondary', category: 'pistols' },
  { weapon: 'weapon_revolver', slot: 'secondary', category: 'pistols' },
]);

export const GRENADE_TYPES = Object.freeze([
  { id: 'HE', classname: 'weapon_hegrenade' },
  { id: 'FLASH', classname: 'weapon_flashbang' },
  { id: 'SMOKE', classname: 'weapon_smokegrenade' },
  { id: 'INCENDIARY', terroristClassname: 'weapon_molotov', counterTerroristClassname: 'weapon_incgrenade' },
  { id: 'DECOY', classname: 'weapon_decoy' },
]);

export const GRAVITY_PERCENT_OPTIONS = Object.freeze([20, 40, 50, 60, 70, 80, 100]);
export const SPEED_PERCENT_OPTIONS = Object.freeze([110, 120, 130, 140, 150]);

const ALL_MODES = Object.freeze({
  SOLO_1V1: {
    enabled: true,
    allowedMapIds: null,
    settings: { roundTimeSeconds: 120, maxRounds: 13, health: 100, armor: 0, startMoney: 10000, maxMoney: 10000, afterRoundMoney: 0 },
  },
  AWP_ONLY: {
    enabled: true,
    allowedMapIds: null,
    settings: { roundTimeSeconds: 120, maxRounds: 13, health: 100, armor: 2, magazineAmmo: null, reserveAmmo: null },
  },
  DEAGLE_ONLY: {
    enabled: true,
    allowedMapIds: null,
    settings: { roundTimeSeconds: 120, maxRounds: 13, health: 100, armor: 2, magazineAmmo: null, reserveAmmo: null },
  },
  KNIFE_ONLY: {
    enabled: true,
    allowedMapIds: null,
    settings: { roundTimeSeconds: 120, maxRounds: 13, health: 100, armor: 2, knifeClassname: 'weapon_knife' },
  },
  HEADSHOT_ONLY: {
    enabled: true,
    allowedMapIds: null,
    settings: { roundTimeSeconds: 120, maxRounds: 13, health: 100, armor: 0, headshotOnly: true },
  },
  RANDOM_WEAPON: {
    enabled: true,
    allowedMapIds: null,
    settings: { roundTimeSeconds: 120, maxRounds: 13, health: 100, armor: 2, weaponPool: RANDOM_WEAPON_CATALOG.map(item => item.weapon), selectionScope: 'MATCH' },
  },
  FIRST_TO_10: {
    enabled: true,
    allowedMapIds: null,
    settings: { roundTimeSeconds: 120, maxRounds: 19, targetKills: 10, health: 100, armor: 0, startMoney: 10000, maxMoney: 10000, afterRoundMoney: 10000 },
  },
  GRENADE_ONLY: {
    enabled: true,
    allowedMapIds: null,
    settings: {
      replenishmentMode: 'COOLDOWN',
      defaultCooldownSeconds: 3,
      grenades: [
        { type: 'HE', count: 1, enabled: true, cooldownSeconds: null },
        { type: 'FLASH', count: 1, enabled: true, cooldownSeconds: null },
        { type: 'SMOKE', count: 1, enabled: true, cooldownSeconds: null },
        { type: 'INCENDIARY', count: 1, enabled: true, cooldownSeconds: null },
        { type: 'DECOY', count: 1, enabled: false, cooldownSeconds: null },
      ],
      knifeAfterExhaustion: true,
    },
  },
  LOW_GRAVITY: {
    enabled: false,
    allowedMapIds: [],
    settings: { gravityPercent: 60, gravityPercentByMap: {}, health: 100, armor: 0 },
  },
  SPEED_DUEL: {
    enabled: false,
    allowedMapIds: null,
    settings: { speedPercent: 140, health: 100, armor: 0 },
  },
});

export const DEFAULT_GAME_MODE_CONFIG = Object.freeze({ schemaVersion: 1, modes: ALL_MODES });

const clone = value => JSON.parse(JSON.stringify(value));
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isIntegerInRange = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
export const LEGACY_COMPAT_GAME_MODE_CONFIG = (() => {
  const config = clone(DEFAULT_GAME_MODE_CONFIG);
  config.modes.GRENADE_ONLY.settings.replenishmentMode = 'ROUND_QUOTA';
  config.modes.GRENADE_ONLY.settings.grenades = config.modes.GRENADE_ONLY.settings.grenades.map(grenade => ({
    ...grenade,
    enabled: grenade.type !== 'DECOY',
    count: grenade.type === 'DECOY' ? 0 : 3,
    cooldownSeconds: null,
  }));
  return config;
})();
const MODE_SETTINGS_KEYS = Object.freeze({
  SOLO_1V1: ['roundTimeSeconds', 'maxRounds', 'health', 'armor', 'startMoney', 'maxMoney', 'afterRoundMoney'],
  AWP_ONLY: ['roundTimeSeconds', 'maxRounds', 'health', 'armor', 'magazineAmmo', 'reserveAmmo'],
  DEAGLE_ONLY: ['roundTimeSeconds', 'maxRounds', 'health', 'armor', 'magazineAmmo', 'reserveAmmo'],
  KNIFE_ONLY: ['roundTimeSeconds', 'maxRounds', 'health', 'armor', 'knifeClassname'],
  HEADSHOT_ONLY: ['roundTimeSeconds', 'maxRounds', 'health', 'armor', 'headshotOnly'],
  RANDOM_WEAPON: ['roundTimeSeconds', 'maxRounds', 'health', 'armor', 'weaponPool', 'selectionScope'],
  FIRST_TO_10: ['roundTimeSeconds', 'maxRounds', 'targetKills', 'health', 'armor', 'startMoney', 'maxMoney', 'afterRoundMoney'],
  GRENADE_ONLY: ['replenishmentMode', 'defaultCooldownSeconds', 'grenades', 'knifeAfterExhaustion'],
  LOW_GRAVITY: ['gravityPercent', 'gravityPercentByMap', 'health', 'armor'],
  SPEED_DUEL: ['speedPercent', 'health', 'armor'],
});

function issue(path, message) { return { path, message }; }

function validateCommon(modeId, raw, defaultValue, validMapIds, errors) {
  if (!isRecord(raw)) {
    errors.push(issue(`modes.${modeId}`, 'must be an object'));
    return clone(defaultValue);
  }
  for (const key of Object.keys(raw)) if (!['enabled', 'allowedMapIds', 'settings'].includes(key)) errors.push(issue(`modes.${modeId}.${key}`, 'is not a supported configuration field'));
  const enabled = raw.enabled === undefined ? defaultValue.enabled : raw.enabled;
  if (typeof enabled !== 'boolean') errors.push(issue(`modes.${modeId}.enabled`, 'must be boolean'));
  let allowedMapIds = raw.allowedMapIds === undefined ? defaultValue.allowedMapIds : raw.allowedMapIds;
  if (allowedMapIds !== null && (!Array.isArray(allowedMapIds) || allowedMapIds.some(id => typeof id !== 'string' || !validMapIds.includes(id)) || new Set(allowedMapIds).size !== allowedMapIds.length)) {
    errors.push(issue(`modes.${modeId}.allowedMapIds`, 'must be null or a unique list of known map IDs'));
    allowedMapIds = defaultValue.allowedMapIds;
  }
  if (enabled === true && Array.isArray(allowedMapIds) && allowedMapIds.length === 0) {
    errors.push(issue(`modes.${modeId}.allowedMapIds`, 'an enabled mode must be available on at least one map'));
  }
  const settings = isRecord(raw.settings) ? { ...defaultValue.settings, ...raw.settings } : clone(defaultValue.settings);
  if (!isRecord(raw.settings)) errors.push(issue(`modes.${modeId}.settings`, 'must be an object'));
  else for (const key of Object.keys(raw.settings)) if (!MODE_SETTINGS_KEYS[modeId].includes(key)) errors.push(issue(`modes.${modeId}.settings.${key}`, 'is not a supported setting'));
  return { enabled: typeof enabled === 'boolean' ? enabled : defaultValue.enabled, allowedMapIds, settings };
}

function validateBaseSettings(modeId, settings, errors, { health = true, armor = true, round = true, money = false } = {}) {
  if (health && !isIntegerInRange(settings.health, 1, 200)) errors.push(issue(`modes.${modeId}.settings.health`, 'must be an integer between 1 and 200'));
  if (armor && !isIntegerInRange(settings.armor, 0, 100)) errors.push(issue(`modes.${modeId}.settings.armor`, 'must be an integer between 0 and 100'));
  if (round) {
    if (!isIntegerInRange(settings.roundTimeSeconds, 30, 600)) errors.push(issue(`modes.${modeId}.settings.roundTimeSeconds`, 'must be an integer between 30 and 600'));
    if (!isIntegerInRange(settings.maxRounds, 1, 99)) errors.push(issue(`modes.${modeId}.settings.maxRounds`, 'must be an integer between 1 and 99'));
  }
  if (money) {
    for (const key of ['startMoney', 'maxMoney', 'afterRoundMoney']) {
      if (!isIntegerInRange(settings[key], 0, 16000)) errors.push(issue(`modes.${modeId}.settings.${key}`, 'must be an integer between 0 and 16000'));
    }
  }
}

function validateModeSettings(modeId, settings, errors, mapIds) {
  const path = `modes.${modeId}.settings`;
  switch (modeId) {
    case 'SOLO_1V1':
      validateBaseSettings(modeId, settings, errors, { money: true });
      break;
    case 'AWP_ONLY':
    case 'DEAGLE_ONLY':
      validateBaseSettings(modeId, settings, errors);
      for (const key of ['magazineAmmo', 'reserveAmmo']) {
        if (settings[key] !== null && !isIntegerInRange(settings[key], 1, 200)) errors.push(issue(`${path}.${key}`, 'must be null (engine default) or an integer between 1 and 200'));
      }
      break;
    case 'KNIFE_ONLY':
      validateBaseSettings(modeId, settings, errors);
      if (settings.knifeClassname !== 'weapon_knife') errors.push(issue(`${path}.knifeClassname`, 'only the currently supported standard knife is allowed'));
      break;
    case 'HEADSHOT_ONLY':
      validateBaseSettings(modeId, settings, errors);
      if (settings.headshotOnly !== true) errors.push(issue(`${path}.headshotOnly`, 'must remain enabled for HEADSHOT_ONLY'));
      break;
    case 'RANDOM_WEAPON': {
      validateBaseSettings(modeId, settings, errors);
      const catalog = new Set(RANDOM_WEAPON_CATALOG.map(item => item.weapon));
      if (!Array.isArray(settings.weaponPool) || settings.weaponPool.length === 0 || settings.weaponPool.some(value => !catalog.has(value)) || new Set(settings.weaponPool).size !== settings.weaponPool.length) {
        errors.push(issue(`${path}.weaponPool`, 'must contain unique weapons from the supported server catalog'));
      }
      if (!['MATCH', 'ROUND'].includes(settings.selectionScope)) errors.push(issue(`${path}.selectionScope`, 'must be MATCH or ROUND'));
      break;
    }
    case 'FIRST_TO_10':
      validateBaseSettings(modeId, settings, errors, { money: true });
      if (!isIntegerInRange(settings.targetKills, 1, 30)) errors.push(issue(`${path}.targetKills`, 'must be an integer between 1 and 30'));
      if (settings.maxRounds < settings.targetKills) errors.push(issue(`${path}.maxRounds`, 'must not be lower than targetKills'));
      break;
    case 'GRENADE_ONLY': {
      if (!['COOLDOWN', 'ROUND_QUOTA'].includes(settings.replenishmentMode)) errors.push(issue(`${path}.replenishmentMode`, 'must be COOLDOWN or ROUND_QUOTA'));
      if (!isIntegerInRange(settings.defaultCooldownSeconds, 1, 30)) errors.push(issue(`${path}.defaultCooldownSeconds`, 'must be an integer between 1 and 30 seconds'));
      if (typeof settings.knifeAfterExhaustion !== 'boolean') errors.push(issue(`${path}.knifeAfterExhaustion`, 'must be boolean'));
      if (!Array.isArray(settings.grenades) || settings.grenades.length === 0) {
        errors.push(issue(`${path}.grenades`, 'must be a non-empty grenade list'));
        break;
      }
      const supported = new Set(GRENADE_TYPES.map(item => item.id));
      const types = settings.grenades.map(item => item?.type);
      if (types.some(type => !supported.has(type)) || new Set(types).size !== types.length) errors.push(issue(`${path}.grenades`, 'types must be unique supported grenade IDs'));
      if (!settings.grenades.some(item => item?.enabled === true && isIntegerInRange(item?.count, 1, 5))) errors.push(issue(`${path}.grenades`, 'at least one enabled type must have a count from 1 to 5'));
      for (const [index, grenade] of settings.grenades.entries()) {
        const grenadePath = `${path}.grenades.${index}`;
        if (isRecord(grenade)) for (const key of Object.keys(grenade)) if (!['type', 'enabled', 'count', 'cooldownSeconds'].includes(key)) errors.push(issue(`${grenadePath}.${key}`, 'is not a supported grenade setting'));
        if (typeof grenade?.enabled !== 'boolean') errors.push(issue(`${grenadePath}.enabled`, 'must be boolean'));
        if (!isIntegerInRange(grenade?.count, 0, 5)) errors.push(issue(`${grenadePath}.count`, 'must be an integer between 0 and 5'));
        if (grenade?.enabled && grenade.count === 0) errors.push(issue(`${grenadePath}.count`, 'enabled grenade types need a count greater than zero'));
        if (grenade?.cooldownSeconds !== null && grenade?.cooldownSeconds !== undefined && (!Number.isFinite(grenade.cooldownSeconds) || grenade.cooldownSeconds < 1 || grenade.cooldownSeconds > 30)) errors.push(issue(`${grenadePath}.cooldownSeconds`, 'must be null or between 1 and 30 seconds'));
      }
      break;
    }
    case 'LOW_GRAVITY': {
      validateBaseSettings(modeId, settings, errors, { round: false });
      if (!GRAVITY_PERCENT_OPTIONS.includes(settings.gravityPercent)) errors.push(issue(`${path}.gravityPercent`, `must be one of ${GRAVITY_PERCENT_OPTIONS.join(', ')}`));
      if (!isRecord(settings.gravityPercentByMap)) errors.push(issue(`${path}.gravityPercentByMap`, 'must be an object keyed by map ID'));
      else for (const [mapId, percent] of Object.entries(settings.gravityPercentByMap)) {
        if (!mapIds.includes(mapId)) errors.push(issue(`${path}.gravityPercentByMap.${mapId}`, 'must reference a known duel map'));
        if (!GRAVITY_PERCENT_OPTIONS.includes(percent)) errors.push(issue(`${path}.gravityPercentByMap.${mapId}`, `must be one of ${GRAVITY_PERCENT_OPTIONS.join(', ')}`));
      }
      break;
    }
    case 'SPEED_DUEL':
      validateBaseSettings(modeId, settings, errors, { round: false });
      if (!SPEED_PERCENT_OPTIONS.includes(settings.speedPercent)) errors.push(issue(`${path}.speedPercent`, `must be one of ${SPEED_PERCENT_OPTIONS.join(', ')}`));
      break;
  }
}

export function validateGameModeConfig(input, { mapIds = [], mapSafetyProfiles = {} } = {}) {
  const errors = [];
  if (!isRecord(input) || input.schemaVersion !== 1 || !isRecord(input.modes)) {
    return { ok: false, errors: [issue('config', 'must contain schemaVersion 1 and a modes object')] };
  }
  for (const key of Object.keys(input)) if (!['schemaVersion', 'modes'].includes(key)) errors.push(issue(key, 'is not a supported root configuration field'));
  const unknownModes = Object.keys(input.modes).filter(mode => !GAME_MODE_IDS.includes(mode));
  if (unknownModes.length) errors.push(issue('modes', `unknown mode IDs: ${unknownModes.join(', ')}`));

  const normalizedModes = {};
  for (const modeId of GAME_MODE_IDS) {
    const defaults = DEFAULT_GAME_MODE_CONFIG.modes[modeId];
    const common = validateCommon(modeId, input.modes[modeId] ?? defaults, defaults, mapIds, errors);
    validateModeSettings(modeId, common.settings, errors, mapIds);
    if (modeId === 'LOW_GRAVITY' && common.enabled) {
      const maps = common.allowedMapIds === null ? mapIds : common.allowedMapIds;
      if (!maps.length) errors.push(issue('modes.LOW_GRAVITY.allowedMapIds', 'no maps were provided for Low Gravity validation'));
      for (const mapId of maps) {
        const profile = mapSafetyProfiles[mapId];
        const requested = common.settings.gravityPercentByMap[mapId] ?? common.settings.gravityPercent;
        if (!profile?.verified || !Number.isInteger(profile.minimumSafeGravityPercent)) {
          errors.push(issue(`modes.LOW_GRAVITY.allowedMapIds.${mapId}`, 'map has no verified runtime safety profile'));
        } else if (requested < profile.minimumSafeGravityPercent) {
          errors.push(issue(`modes.LOW_GRAVITY.settings.gravityPercentByMap.${mapId}`, `must be at least the verified safe minimum ${profile.minimumSafeGravityPercent}%`));
        }
      }
    }
    normalizedModes[modeId] = common;
  }

  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: { schemaVersion: 1, modes: normalizedModes } };
}

export function modeIsAvailable(config, modeId, mapId, mapSupported = true) {
  const mode = config?.modes?.[modeId];
  if (!mode?.enabled || !mapSupported) return false;
  return mode.allowedMapIds === null || mode.allowedMapIds.includes(mapId);
}

/**
 * Public-safe per-map availability for the create-match selectors.
 * Only exposes a boolean and a reason code, never unpublished config settings.
 * LOW_GRAVITY additionally requires a verified server-derived safety profile.
 */
export function buildGameModeAvailability(config, mapCatalog, mapSafetyProfiles = {}) {
  if (!Array.isArray(mapCatalog)) throw new TypeError('mapCatalog must be an array');
  return mapCatalog.map(map => {
    const modes = Object.fromEntries(GAME_MODE_IDS.map(modeId => {
      const mapSupported = map?.supportedModes?.[modeId] === true;
      const mode = config?.modes?.[modeId];
      const profile = mapSafetyProfiles?.[map?.id];
      let reason = null;

      if (!mapSupported) reason = 'MAP_UNSUPPORTED';
      else if (modeId === 'LOW_GRAVITY' && (!profile || profile.verified !== true || !isIntegerInRange(profile.minimumSafeGravityPercent, 20, 100))) {
        reason = 'SAFETY_PROFILE_REQUIRED';
      } else if (!mode || mode.enabled !== true) reason = 'MODE_DISABLED';
      else if (Array.isArray(mode.allowedMapIds) && !mode.allowedMapIds.includes(map.id)) reason = 'MAP_NOT_ALLOWED';
      else if (modeId === 'LOW_GRAVITY') {
        const requested = mode.settings?.gravityPercentByMap?.[map.id] ?? mode.settings?.gravityPercent;
        if (!GRAVITY_PERCENT_OPTIONS.includes(requested)) reason = 'INVALID_MODE_SETTINGS';
        else if (requested < profile.minimumSafeGravityPercent) reason = 'UNSAFE_GRAVITY_SETTINGS';
      }

      const available = reason === null && modeIsAvailable(config, modeId, map.id, mapSupported);
      return [modeId, { available, reason: available ? null : (reason ?? 'CONFIG_UNAVAILABLE') }];
    }));
    return { mapId: map.id, serverMapName: map.serverMapName, modes };
  });
}

export function snapshotForMatch(config, modeId, mapId, version = 0, checksum = null) {
  const mode = config?.modes?.[modeId];
  if (!mode) throw new Error(`Unknown game mode configuration: ${modeId}`);
  const modeSnapshot = { ...mode };
  delete modeSnapshot.allowedMapIds;
  return clone({ schemaVersion: 1, version, checksum, modeId, mapId, mode: modeSnapshot });
}

/**
 * Extract and validate the immutable mode settings snapshot attached to a match.
 * Legacy modes do not consume this runtime-only settings object. Advanced modes
 * fail closed unless the snapshot is tied to the exact mode and map being started.
 */
export function extractMatchModeSettings(modeId, snapshot, mapId) {
  if (modeId !== 'LOW_GRAVITY' && modeId !== 'SPEED_DUEL') return {};

  const unavailable = () => { throw new Error('MODE_CONFIG_UNAVAILABLE'); };
  if (!isRecord(snapshot)
    || snapshot.schemaVersion !== 1
    || snapshot.modeId !== modeId
    || typeof mapId !== 'string'
    || !mapId
    || snapshot.mapId !== mapId
    || !isRecord(snapshot.mode)
    || snapshot.mode.enabled !== true
    || !isRecord(snapshot.mode.settings)) {
    return unavailable();
  }

  const settings = snapshot.mode.settings;
  if (modeId === 'LOW_GRAVITY') {
    if (!GRAVITY_PERCENT_OPTIONS.includes(settings.gravityPercent)
      || settings.gravityPercent < MINIMUM_SAFE_GRAVITY_PERCENT) return unavailable();

    let gravityPercent = settings.gravityPercent;
    if (settings.gravityPercentByMap !== undefined) {
      if (!isRecord(settings.gravityPercentByMap)) return unavailable();
      for (const value of Object.values(settings.gravityPercentByMap)) {
        if (!GRAVITY_PERCENT_OPTIONS.includes(value)) return unavailable();
      }
      if (Object.prototype.hasOwnProperty.call(settings.gravityPercentByMap, mapId)) {
        gravityPercent = settings.gravityPercentByMap[mapId];
      }
    }
    if (!GRAVITY_PERCENT_OPTIONS.includes(gravityPercent)
      || gravityPercent < MINIMUM_SAFE_GRAVITY_PERCENT) return unavailable();
    return { gravityPercent };
  }

  if (!SPEED_PERCENT_OPTIONS.includes(settings.speedPercent)) return unavailable();
  return { speedPercent: settings.speedPercent };
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function gameModeConfigChecksum(config) {
  return createHash('sha256').update(canonicalJson(config)).digest('hex');
}

export function allConfigServersAcknowledged(acks, checksum) {
  return GAME_MODE_CONFIG_SERVER_NAMES.every(name => acks.some(ack => {
    const capabilities = Array.isArray(ack.capabilities) ? ack.capabilities : [];
    return ack.serverName === name
      && ack.checksum === checksum
      && ['STAGED', 'APPLIED'].includes(ack.status)
      && ack.modeControllerVersion === GAME_MODE_CONTROLLER_VERSION
      && REQUIRED_GAME_MODE_CONTROLLER_CAPABILITIES.every(required => capabilities.includes(required));
  }));
}
