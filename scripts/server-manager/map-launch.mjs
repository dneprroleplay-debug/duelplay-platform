import { buildDuelModeCommands } from './mode-policy.mjs';

// Mirrors the serverMapName values of lib/duel-maps.ts so custom maps are never
// prefixed with de_ (which produced cfg/maps configs under names CS2 never loads).
export const CUSTOM_MAP_NAMES = new Set([
  'aim_redline', 'aim_dust2', 'fy_pool_day', '1v1_map', 'minecraft_aim_map',
  'aim_cache', 'fy_snow', '1vs1_aim_map_arena', '1v1_de_anubis_aim', 'aim_halloween'
]);

// Workshop items whose internal BSP name differs from the catalog serverMapName.
// These are the real map names CS2 logs in "Loading map", not publish_data's
// source_folder. The per-match cfg is written for every known name so rules
// apply after Workshop load even when the map is not downloaded yet.
export const WORKSHOP_MAP_SOURCE_FOLDERS = Object.freeze({
  '3101654056': 'fistmap',
  '3512082348': 'untitled_4',
  '3754320383': 'aim_cache',
  '3592238209': 'fy_snow_legacy',
  '3383710636': 'colosseummaphure',
  '3596198331': 'halloween_map',
  '3655222443': 'de_minecraft_aim_map',
});

export function mapCode(name) {
  const raw = String(name || 'Dust2').trim();
  const normalized = raw.replace(/^de_/, '').toLowerCase();
  if (CUSTOM_MAP_NAMES.has(normalized)) return normalized;
  const aliases = { dust2: 'de_dust2' };
  return aliases[normalized] || `de_${normalized}`;
}

export function safeMapConfigName(name) {
  const value = String(name || '').trim().toLowerCase();
  return /^[a-z0-9_]+$/.test(value) ? value : null;
}

export function normalizeWorkshopId(workshopId) {
  return workshopId == null ? '' : String(workshopId).trim();
}

// publish_data.txt exposes the author's source_folder. It is not guaranteed to
// match the internal BSP name (3383710636 says testmap but loads
// colosseummaphure), so it is only an extra cfg-name fallback.
export function parseWorkshopSourceFolder(contents) {
  const match = String(contents ?? '').match(/"source_folder"\s+"([^"]+)"/i);
  return match ? match[1].trim() : null;
}

// Every config name the per-match rules must be written under: the raw catalog
// name, its mapCode fallback, and the Workshop item's internal BSP folder name.
export function buildMapConfigNames(mapName, workshopId, publishedSourceFolder = null) {
  const names = new Set();
  if (mapName) names.add(String(mapName));
  const fallback = mapCode(mapName);
  if (fallback) names.add(String(fallback));
  const publishedName = publishedSourceFolder ? String(publishedSourceFolder).trim().toLowerCase() : null;
  const workshopName = WORKSHOP_MAP_SOURCE_FOLDERS[normalizeWorkshopId(workshopId)];
  if (publishedName) names.add(publishedName);
  if (workshopName) names.add(String(workshopName).trim().toLowerCase());
  return [...names];
}

export function buildMatchMapConfig(mode, weaponModifier, randomWeapon = null) {
  return [
    '// DuelPlay per-match map rules. Generated before Workshop map load.',
    ...buildDuelModeCommands(mode, weaponModifier, randomWeapon),
  ].join('\n') + '\n';
}

// Workshop maps boot through the official default map, then host_workshop_map
// loads the item. A custom map without a Workshop ID can never be resolved.
export function buildMapLaunchArgs(mapName, workshopId) {
  const id = normalizeWorkshopId(workshopId);
  if (id) return ['+map', 'de_dust2', '+host_workshop_map', id];
  const fallback = mapCode(mapName);
  if (/^(aim_|fy_|1v1_|1vs1_|minecraft_aim_map)/i.test(fallback)) {
    throw new Error(`Workshop ID is required for custom duel map: ${fallback}`);
  }
  return ['+map', fallback];
}
