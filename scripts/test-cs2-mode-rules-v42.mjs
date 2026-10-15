import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildDuelModeCommands,
  chooseRandomWeapon,
  getFirstToTenWinnerTeam,
  getRuleReapplyDelays,
} from './server-manager/mode-policy.mjs';

const manager = readFileSync('scripts/server-manager/server-manager.mjs', 'utf8');
const modePolicySource = readFileSync('scripts/server-manager/mode-policy.mjs', 'utf8');
const catalog = readFileSync('lib/duel-maps.ts', 'utf8');
const modes = ['SOLO_1V1', 'AWP_ONLY', 'DEAGLE_ONLY', 'KNIFE_ONLY', 'HEADSHOT_ONLY', 'RANDOM_WEAPON', 'FIRST_TO_10', 'GRENADE_ONLY'];
const maps = [...catalog.matchAll(/id: "([^"]+)"/g)].map((match) => match[1]);
assert.equal(maps.length, 10, 'the catalog must retain exactly ten maps with the shared all-mode support set');
const mapCatalogBody = catalog.slice(catalog.indexOf('export const DUEL_MAPS'), catalog.indexOf('export const DUEL_MAP_IDS'));
const mapEntries = [...mapCatalogBody.matchAll(/\{\s*id: "([^"]+)"([\s\S]*?)\n  \},/g)];
assert.equal(mapEntries.length, 10, 'all ten catalog entries are enumerated');
for (const [, mapId, body] of mapEntries) assert.match(body, /supportedModes: ALL_GAMEPLAY/, `${mapId} must reference the complete supported-mode set`);
assert.match(catalog, /const ALL_GAMEPLAY = \{[\s\S]*?\} as const;/);
const supportBlock = catalog.match(/const ALL_GAMEPLAY = \{([\s\S]*?)\} as const;/)?.[1] ?? '';
for (const mode of modes) assert.match(supportBlock, new RegExp(`${mode}: true`), `${mode} must be supported on every map`);

function finalRules(mode, modifier = null, randomWeapon = null) {
  const result = new Map();
  for (const command of buildDuelModeCommands(mode, modifier, randomWeapon)) {
    const [name, ...value] = command.split(' ');
    result.set(name, value.join(' '));
  }
  return result;
}

for (const mode of modes) {
  const rules = finalRules(mode);
  const expectedMelee = mode === 'GRENADE_ONLY' ? '0' : 'weapon_knife';
  assert.equal(rules.get('mp_t_default_melee'), expectedMelee, `${mode} sets the T knife policy`);
  assert.equal(rules.get('mp_ct_default_melee'), expectedMelee, `${mode} sets the CT knife policy`);
  assert.equal(rules.get('duelplay_grenade_only'), mode === 'GRENADE_ONLY' ? '1' : '0', `${mode} toggles only its matching grenade-only plugin mode`);
}

const solo = finalRules('SOLO_1V1');
assert.equal(solo.get('mp_buy_allow_guns'), '255');
assert.equal(solo.get('mp_buy_allow_grenades'), '1');
assert.equal(solo.get('mp_damage_headshot_only'), '0');
assert.equal(solo.get('mp_t_default_melee'), 'weapon_knife');
const soloAfterAwp = finalRules('SOLO_1V1');
assert.equal(soloAfterAwp.get('mp_t_default_primary'), 'weapon_ak47', 'SOLO resets the previous AWP default');
assert.equal(soloAfterAwp.get('mp_weapons_allow_rifles'), '-1', 'SOLO reopens normal rifle access');
assert.equal(soloAfterAwp.get('mp_weapons_allow_map_placed'), '1', 'SOLO restores map pickups');

const awp = finalRules('SOLO_1V1', 'AWP_ONLY');
assert.equal(awp.get('mp_t_default_primary'), 'weapon_awp');
assert.equal(awp.get('mp_ct_default_primary'), 'weapon_awp');
assert.equal(awp.get('mp_weapons_allow_rifles'), '1', 'the required AWP category remains enabled');
assert.equal(awp.get('mp_weapons_allow_pistols'), '0');
assert.equal(awp.get('mp_t_default_secondary'), '0');
assert.equal(awp.get('mp_t_default_melee'), 'weapon_knife', 'AWP mode keeps its knife');
assert.equal(awp.get('mp_t_default_grenades'), '0');
assert.equal(awp.get('mp_buy_allow_guns'), '0');
assert.equal(awp.get('mp_weapons_allow_map_placed'), '0');

const deagle = finalRules('DEAGLE_ONLY');
assert.equal(deagle.get('mp_weapons_allow_pistols'), '1', 'the required pistol category remains enabled');
assert.equal(deagle.get('mp_t_default_secondary'), 'weapon_deagle');
assert.equal(deagle.get('mp_ct_default_secondary'), 'weapon_deagle');
assert.equal(deagle.get('mp_t_default_primary'), '0');
assert.equal(deagle.get('mp_t_default_melee'), 'weapon_knife', 'Deagle mode keeps its knife');
assert.equal(deagle.get('mp_t_default_grenades'), '0');
assert.equal(deagle.get('mp_buy_allow_guns'), '0');

const knife = finalRules('KNIFE_ONLY');
assert.equal(knife.get('mp_t_default_melee'), 'weapon_knife');
assert.equal(knife.get('mp_t_default_primary'), '0');
assert.equal(knife.get('mp_t_default_secondary'), '0');
assert.equal(knife.get('mp_t_default_grenades'), '0');

const headshot = finalRules('HEADSHOT_ONLY');
assert.equal(headshot.get('mp_damage_headshot_only'), '1');
assert.equal(headshot.get('mp_buy_allow_guns'), '255');
assert.equal(solo.get('mp_damage_headshot_only'), '0', 'normal mode explicitly clears a prior map headshot restriction');

const randomWeapon = chooseRandomWeapon(() => 0.25);
const randomOne = finalRules('RANDOM_WEAPON', null, randomWeapon);
const randomRepeat = finalRules('RANDOM_WEAPON', null, randomWeapon);
assert.deepEqual(randomRepeat, randomOne, 'the same match weapon remains selected when rules are reapplied');
assert.equal(randomOne.get(`mp_${randomWeapon.slot === 'primary' ? 't_default_primary' : 't_default_secondary'}`), randomWeapon.weapon);
assert.equal(randomOne.get(`mp_${randomWeapon.slot === 'primary' ? 'ct_default_primary' : 'ct_default_secondary'}`), randomWeapon.weapon);
assert.equal(randomOne.get('mp_t_default_melee'), 'weapon_knife');
assert.equal(randomOne.get('mp_buy_allow_guns'), '0');
assert.equal(randomOne.get(`mp_weapons_allow_${randomWeapon.category}`), '1');
for (const category of ['pistols', 'smgs', 'rifles', 'heavy']) {
  if (category !== randomWeapon.category) assert.equal(randomOne.get(`mp_weapons_allow_${category}`), '0');
}

const grenade = finalRules('GRENADE_ONLY');
assert.equal(grenade.get('mp_t_default_primary'), '0');
assert.equal(grenade.get('mp_t_default_secondary'), '0');
assert.equal(grenade.get('mp_t_default_melee'), '0', 'the grenade plugin grants the knife only after the per-player grenade quota is spent');
assert.equal(grenade.get('mp_t_default_grenades'), '0', 'the plugin supplies the bounded grenade loadout');
assert.equal(grenade.get('ammo_grenade_limit_total'), '12');
assert.equal(grenade.get('ammo_grenade_limit_default'), '3');
assert.equal(grenade.get('ammo_grenade_limit_flashbang'), '3');

const firstTo10 = finalRules('FIRST_TO_10');
assert.equal(firstTo10.get('mp_maxrounds'), '19');
assert.equal(firstTo10.get('mp_match_can_clinch'), '1');
assert.equal(getFirstToTenWinnerTeam(10, 7), 'CT');
assert.equal(getFirstToTenWinnerTeam(8, 10), 'T');
assert.equal(getFirstToTenWinnerTeam(9, 9), null);
assert.equal(getFirstToTenWinnerTeam(-1, 9), null);

assert.deepEqual(getRuleReapplyDelays('GAME_COMMENCING'), [50, 100, 250, 500]);
assert.deepEqual(getRuleReapplyDelays('MATCH_START'), [0, 100, 500]);
assert.deepEqual(getRuleReapplyDelays('ROUND_START'), [150, 1000, 2500, 5000]);
assert.deepEqual(getRuleReapplyDelays('PLAYER_CONNECTED'), [250, 750, 1500, 2500]);
assert.equal(getRuleReapplyDelays('MATCH_FINISHED').length, 0);
assert.match(manager, /buildDuelModeCommands\(mode, weaponModifier/);
assert.match(manager, /writeMatchMapConfig\(\[\.\.\.mapConfigNames\], mode, weaponModifier, randomWeapon\)/);
assert.match(manager, /for \(const delay of getRuleReapplyDelays\('ROUND_START'\)\)/);
assert.match(manager, /function applyDuelRules\(mode, weaponModifier\)[\s\S]*?buildDuelModeCommands\(mode, weaponModifier/);
assert.match(manager, /for \(const timer of duelRuleTimers\) clearTimeout\(timer\)/, 'round and map reapply timers are cleared at lifecycle end');
assert.match(manager, /duelRuleTimers\.add\(timer\)/);
assert.match(manager, /if \(!current \|\| current\.id !== matchId \|\| resultSent\) return/);
assert.match(manager, /child\.on\('exit',[\s\S]*?clearCurrentTimers\(\)/, 'match completion/cancellation clears scheduled rules when the server exits');
assert.match(manager, /\['FINISHED', 'CANCELLED'\]\.includes\(state\.match\?\.status\)/, 'finished and cancelled matches close their dedicated server');
assert.match(manager, /claimed\.mode \|\| match\.mode \|\| 'SOLO_1V1'/, 'manager receives the canonical claimed mode');
assert.match(manager, /claimed\.weaponModifier \|\| match\.weaponModifier \|\| null/, 'manager receives the canonical weapon modifier');
const applyRulesBody = manager.slice(manager.indexOf('function applyDuelRules'), manager.indexOf('const WORKSHOP_MAP_SOURCE_FOLDERS'));
assert.doesNotMatch(applyRulesBody, /pulseGrenadeLoadout\(\)/, 'general applyDuelRules must not grant grenade loadouts');
assert.match(modePolicySource, /mp_damage_headshot_only \$\{headshotOnly \? '1' : '0'\}/, 'all map reapplications set the headshot rule explicitly');
assert.match(modePolicySource, /duelplay_grenade_only \$\{effectiveMode === 'GRENADE_ONLY' \? '1' : '0'\}/, 'GRENADE_ONLY enforcement stays enabled only for that mode');
assert.match(manager, /getFirstToTenWinnerTeam\(ctScore, tScore\)/);
assert.match(manager, /FIRST_TO_10 reached/);

const grenadePlugin = readFileSync('scripts/cs2-plugins/DuelPlayGrenadeOnly/DuelPlayGrenadeOnly.cs', 'utf8');
assert.match(grenadePlugin, /GiveNamedItem/);
assert.match(grenadePlugin, /PreventWeaponPickup = true/);
assert.match(grenadePlugin, /RegisterEventHandler<EventGrenadeThrown>/, 'knife availability follows actual grenade throws');
assert.match(grenadePlugin, /CountGrenades\(pawn\)/, 'GRENADE_ONLY verifies the actual inventory after issuing items');
assert.match(grenadePlugin, /state\.ResetForNewRound\(_roundNumber\)/, 'GRENADE_ONLY resets per-player quotas using a new engine round identity');
console.log(`CS2 mode policy: ${maps.length} maps × ${modes.length} modes; mode command, round, and winner regressions PASS`);
