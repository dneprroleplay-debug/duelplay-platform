import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildDuelModeCommands,
  chooseRandomWeapon,
  getFirstToTenWinnerTeam,
  getRuleReapplyDelays,
} from './server-manager/mode-policy.mjs';
import {
  CUSTOM_MAP_NAMES,
  WORKSHOP_MAP_SOURCE_FOLDERS,
  buildMapConfigNames,
  buildMapLaunchArgs,
  buildMatchMapConfig,
  mapCode,
  safeMapConfigName,
} from './server-manager/map-launch.mjs';

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

const mapDetails = mapEntries.map(([, mapId, body]) => ({
  id: mapId,
  serverMapName: body.match(/serverMapName: "([^"]+)"/)?.[1] ?? null,
  workshopId: body.match(/workshopId: "([^"]+)"/)?.[1] ?? null,
}));
for (const map of mapDetails) {
  assert.ok(map.serverMapName, `${map.id} declares a serverMapName`);
  assert.ok(/^\d{9,10}$/.test(map.workshopId ?? ''), `${map.id} declares a numeric Workshop ID`);
}
assert.equal(new Set(mapDetails.map((map) => map.serverMapName)).size, 10, 'server map names are unique');
assert.equal(new Set(mapDetails.map((map) => map.workshopId)).size, 10, 'Workshop IDs are unique');
assert.equal(new Set(mapDetails.map((map) => map.id)).size, 10, 'map IDs are unique');

// Per-map catalog -> manager wiring: every catalog serverMapName must resolve to a
// real config name and a real launch command, without a bogus de_ prefix.
for (const map of mapDetails) {
  const code = mapCode(map.serverMapName);
  assert.ok(CUSTOM_MAP_NAMES.has(code), `${map.serverMapName} resolves to a custom map code (got "${code}")`);
  assert.doesNotMatch(code, /^de_/, `${map.serverMapName} must not be launched as a de_ map`);
  const configNames = buildMapConfigNames(map.serverMapName, map.workshopId);
  assert.ok(configNames.includes(map.serverMapName), `${map.id} writes the raw catalog name to cfg/maps`);
  assert.ok(configNames.includes(code), `${map.id} writes the mapCode fallback to cfg/maps`);
  for (const name of configNames) assert.ok(safeMapConfigName(name), `${map.id} config name "${name}" is a valid cfg file name`);
  const internalName = WORKSHOP_MAP_SOURCE_FOLDERS[map.workshopId];
  if (internalName) assert.ok(configNames.includes(internalName), `${map.id} also writes the Workshop internal name ${internalName}`);
  assert.deepEqual(
    buildMapLaunchArgs(map.serverMapName, map.workshopId),
    ['+map', 'de_dust2', '+host_workshop_map', map.workshopId],
    `${map.id} launches through the Workshop host command`,
  );
  assert.throws(() => buildMapLaunchArgs(map.serverMapName, ''), /Workshop ID is required/, `${map.id} cannot launch without its Workshop ID`);
}
for (const workshopId of Object.keys(WORKSHOP_MAP_SOURCE_FOLDERS)) {
  assert.ok(mapDetails.some((map) => map.workshopId === workshopId), `WORKSHOP_MAP_SOURCE_FOLDERS entry ${workshopId} must reference a catalog map`);
}
assert.deepEqual(buildMapLaunchArgs('Dust2', ''), ['+map', 'de_dust2'], 'the official fallback map launches by name');
assert.deepEqual(buildMapLaunchArgs('de_mirage', null), ['+map', 'de_mirage'], 'standard maps boot directly without a Workshop item');

// The manager must pass the selected map and Workshop ID through the shared helpers.
assert.match(manager, /buildMapConfigNames\(match\.mapName, workshopId\)/, 'manager derives cfg names from the catalog map + Workshop ID');
assert.match(manager, /writeMatchMapConfig\(mapConfigNames, mode, weaponModifier, randomWeapon\)/, 'manager writes the per-match rules for that map');
assert.match(manager, /buildMapLaunchArgs\(match\.mapName, workshopId\)/, 'manager derives launch args from the catalog map + Workshop ID');

function finalRules(mode, modifier = null, randomWeapon = null) {
  const result = new Map();
  for (const command of buildDuelModeCommands(mode, modifier, randomWeapon)) {
    const [name, ...value] = command.split(' ');
    result.set(name, value.join(' '));
  }
  return result;
}

// Parse the real per-match config file content that writeMatchMapConfig would drop
// into csgo/cfg/maps/<name>.cfg, so the matrix checks the shipped artifact.
function mapConfigRules(mode, modifier = null, randomWeapon = null) {
  const content = buildMatchMapConfig(mode, modifier, randomWeapon);
  assert.match(content, /^\/\/ DuelPlay per-match map rules\. Generated before Workshop map load\.\n/, `${mode} config keeps its header`);
  const result = new Map();
  for (const line of content.split('\n')) {
    if (!line || line.startsWith('//')) continue;
    const [name, ...value] = line.split(' ');
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

// Full 10 maps x 8 modes matrix: for every catalog map we build the real cfg
// content and assert the mode-correct rules, so a regression on any single
// map/mode combination fails with the offending map id.
const RESTRICTED_MODES = new Set(['AWP_ONLY', 'DEAGLE_ONLY', 'KNIFE_ONLY', 'RANDOM_WEAPON', 'GRENADE_ONLY']);
assert.equal(modes.length * mapDetails.length, 80, 'the mode/map matrix must cover 8 modes over 10 maps');
let matrixChecked = 0;
for (const map of mapDetails) {
  for (const mode of modes) {
    const rules = mapConfigRules(mode);
    const restricted = RESTRICTED_MODES.has(mode);
    const at = `${mode} on ${map.id} (${map.serverMapName})`;
    assert.equal(rules.get('duelplay_grenade_only'), mode === 'GRENADE_ONLY' ? '1' : '0', `${at} toggles grenade-only`);
    assert.equal(rules.get('mp_damage_headshot_only'), mode === 'HEADSHOT_ONLY' ? '1' : '0', `${at} sets headshot-only`);
    assert.equal(rules.get('mp_buy_allow_guns'), restricted ? '0' : '255', `${at} sets the buy policy`);
    assert.equal(rules.get('mp_t_default_grenades'), '0', `${at} never grants engine grenades`);
    assert.equal(rules.get('mp_t_default_melee'), mode === 'GRENADE_ONLY' ? '0' : 'weapon_knife', `${at} sets the knife policy`);
    assert.equal(rules.get('mp_maxrounds'), '19', `${at} keeps the 19-round ceiling`);
    assert.equal(rules.get('mp_respawn_on_death_t'), mode === 'GRENADE_ONLY' ? '1' : '0', `${at} respawns on death only in grenade mode`);
    assert.equal(rules.get('mp_respawn_on_death_ct'), mode === 'GRENADE_ONLY' ? '1' : '0', `${at} respawns on death only in grenade mode`);
    assert.equal(rules.get('mp_use_respawn_waves'), '0', `${at} keeps respawn waves off so a respawn is immediate`);
    assert.equal(rules.get('mp_autokick'), mode === 'GRENADE_ONLY' ? '0' : '1', `${at} sets the suicide-kick policy explicitly`);
    if (mode === 'GRENADE_ONLY') {
      assert.equal(rules.get('ammo_grenade_limit_total'), '12', `${at} grenade total cap`);
      assert.equal(rules.get('ammo_grenade_limit_default'), '3', `${at} grenade default cap`);
      assert.equal(rules.get('ammo_grenade_limit_flashbang'), '3', `${at} flashbang cap`);
      assert.equal(rules.get('mp_respawnwavetime_t'), '0', `${at} immediate T respawn`);
      assert.equal(rules.get('mp_respawnwavetime_ct'), '0', `${at} immediate CT respawn`);
    }
    if (mode === 'AWP_ONLY') assert.equal(rules.get('mp_t_default_primary'), 'weapon_awp', `${at} primary`);
    if (mode === 'DEAGLE_ONLY') assert.equal(rules.get('mp_t_default_secondary'), 'weapon_deagle', `${at} secondary`);
    if (mode === 'KNIFE_ONLY') assert.equal(rules.get('mp_t_default_primary'), '0', `${at} has no primary`);
    matrixChecked += 1;
  }
}
assert.equal(matrixChecked, 80, 'every one of the 80 map/mode combinations was evaluated');

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
assert.equal(awp.get('mp_weapons_allow_rifles'), '-1', 'the required AWP category remains enabled for both teams');
assert.equal(awp.get('mp_weapons_allow_pistols'), '0');
assert.equal(awp.get('mp_t_default_secondary'), '0');
assert.equal(awp.get('mp_t_default_melee'), 'weapon_knife', 'AWP mode keeps its knife');
assert.equal(awp.get('mp_t_default_grenades'), '0');
assert.equal(awp.get('mp_buy_allow_guns'), '0');
assert.equal(awp.get('mp_weapons_allow_map_placed'), '0');

const deagle = finalRules('DEAGLE_ONLY');
assert.equal(deagle.get('mp_weapons_allow_pistols'), '-1', 'the required pistol category remains enabled for both teams');
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
assert.equal(randomOne.get(`mp_weapons_allow_${randomWeapon.category}`), '-1');
for (const category of ['pistols', 'smgs', 'rifles', 'heavy']) {
  if (category !== randomWeapon.category) assert.equal(randomOne.get(`mp_weapons_allow_${category}`), '0');
}

// mp_weapons_allow_<category> only accepts -1 / 0 / 2 / 3. A stray "1" silently
// disables the category (neither team may carry it), which is exactly how the
// AWP/Deagle/random matches ended up knife-only. Guard every generated mode.
const allowValuePattern = /^mp_weapons_allow_(pistols|smgs|rifles|heavy) (\S+)$/;
for (const mode of modes) {
  for (const command of buildDuelModeCommands(mode, null, randomWeapon)) {
    const match = command.match(allowValuePattern);
    if (!match) continue;
    assert.ok(['-1', '0', '2', '3'].includes(match[2]), `${mode} emits a valid ${match[1]} allow value (got "${match[2]}")`);
  }
}

const grenade = finalRules('GRENADE_ONLY');
assert.equal(grenade.get('mp_t_default_primary'), '0');
assert.equal(grenade.get('mp_t_default_secondary'), '0');
assert.equal(grenade.get('mp_t_default_melee'), '0', 'the grenade plugin grants the knife only after the per-player grenade quota is spent');
assert.equal(grenade.get('mp_t_default_grenades'), '0', 'the plugin supplies the bounded grenade loadout');
assert.equal(grenade.get('ammo_grenade_limit_total'), '12');
assert.equal(grenade.get('ammo_grenade_limit_default'), '3');
assert.equal(grenade.get('ammo_grenade_limit_flashbang'), '3');
assert.equal(grenade.get('mp_respawn_on_death_t'), '1', 'GRENADE_ONLY respawns dead players inside the round');
assert.equal(grenade.get('mp_respawn_on_death_ct'), '1', 'GRENADE_ONLY respawns dead players inside the round');
assert.equal(grenade.get('mp_use_respawn_waves'), '0', 'GRENADE_ONLY respawns immediately without waves');
assert.equal(grenade.get('mp_respawnwavetime_t'), '0', 'GRENADE_ONLY has no T respawn wave delay');
assert.equal(grenade.get('mp_respawnwavetime_ct'), '0', 'GRENADE_ONLY has no CT respawn wave delay');
assert.equal(grenade.get('mp_autokick'), '0', 'GRENADE_ONLY disables CS2 five-suicide kick');
assert.equal(solo.get('mp_respawn_on_death_t'), '0', 'the respawn-on-death rule is reset outside grenade mode');
assert.equal(solo.get('mp_respawn_on_death_ct'), '0', 'the respawn-on-death rule is reset outside grenade mode');
assert.equal(solo.get('mp_autokick'), '1', 'leaving GRENADE_ONLY restores the normal five-suicide kick');
assert.equal(finalRules('GRENADE_ONLY').get('mp_autokick'), '0', 're-entering GRENADE_ONLY disables the kick again');

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
assert.match(manager, /for \(const delay of getRuleReapplyDelays\('ROUND_START'\)\)/);
assert.match(manager, /function applyDuelRules\(mode, weaponModifier\)[\s\S]*?buildDuelModeCommands\(mode, weaponModifier/);
assert.match(manager, /for \(const timer of duelRuleTimers\) clearTimeout\(timer\)/, 'round and map reapply timers are cleared at lifecycle end');
assert.match(manager, /duelRuleTimers\.add\(timer\)/);
assert.match(manager, /if \(!current \|\| current\.id !== matchId \|\| resultSent\) return/);
assert.match(manager, /child\.on\('exit',[\s\S]*?clearCurrentTimers\(\)/, 'match completion/cancellation clears scheduled rules when the server exits');
assert.match(manager, /\['FINISHED', 'CANCELLED'\]\.includes\(state\.match\?\.status\)/, 'finished and cancelled matches close their dedicated server');
assert.match(manager, /claimed\.mode \|\| match\.mode \|\| 'SOLO_1V1'/, 'manager receives the canonical claimed mode');
assert.match(manager, /claimed\.weaponModifier \|\| match\.weaponModifier \|\| null/, 'manager receives the canonical weapon modifier');
const applyRulesBody = manager.slice(manager.indexOf('function applyDuelRules'), manager.indexOf('function writeMatchMapConfig'));
assert.doesNotMatch(applyRulesBody, /pulseGrenadeLoadout\(\)/, 'general applyDuelRules must not grant grenade loadouts');
assert.match(modePolicySource, /mp_damage_headshot_only \$\{headshotOnly \? '1' : '0'\}/, 'all map reapplications set the headshot rule explicitly');
assert.match(modePolicySource, /duelplay_grenade_only \$\{effectiveMode === 'GRENADE_ONLY' \? '1' : '0'\}/, 'GRENADE_ONLY enforcement stays enabled only for that mode');
assert.match(modePolicySource, /mp_autokick \$\{grenadeOnly \? '0' : '1'\}/, 'mp_autokick is explicit in every generated mode');
assert.match(manager, /getFirstToTenWinnerTeam\(ctScore, tScore\)/);
assert.match(manager, /FIRST_TO_10 reached/);
assert.match(manager, /writeIfChanged\(join\(cfgDir, name\)/, 'generated mode cfgs are refreshed when the mode policy changes');
assert.doesNotMatch(manager, /writeIfMissing\(join\(cfgDir, name\)/, 'mode cfgs are never frozen at first boot, so stale invalid rules cannot persist');

const grenadePlugin = readFileSync('scripts/cs2-plugins/DuelPlayGrenadeOnly/DuelPlayGrenadeOnly.cs', 'utf8');
assert.match(grenadePlugin, /GiveNamedItem/);
assert.match(grenadePlugin, /PreventWeaponPickup = true/);
const grenadePhase = grenadePlugin.slice(grenadePlugin.indexOf('private void ApplyLoadout'), grenadePlugin.indexOf('private void GiveKnifeIfGrenadesSpent'));
assert.doesNotMatch(grenadePhase, /BlockPickup\(/, 'GRENADE_ONLY keeps pickup unblocked during the grenade phase so the last grenade can be re-equipped');
assert.match(grenadePlugin, /RegisterEventHandler<EventGrenadeThrown>/, 'knife availability follows actual grenade throws');
assert.match(grenadePlugin, /CountGrenades\(pawn\)/, 'GRENADE_ONLY verifies the actual inventory after issuing items');
assert.match(grenadePlugin, /state\.ResetForNewRound\(_roundNumber\)/, 'GRENADE_ONLY resets per-player quotas using a new engine round identity');
assert.doesNotMatch(grenadePlugin, /GamePhase|ResetForNewPhase/, 'the half is never used to reset the grenade set');
console.log(`CS2 mode policy: ${mapDetails.length} maps × ${modes.length} modes (${matrixChecked} combinations); map cfg/launch wiring, mode command, round, and winner regressions PASS`);
