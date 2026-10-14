import fs from 'node:fs';
import assert from 'node:assert/strict';
import { buildDuelModeCommands, getRuleReapplyDelays } from './server-manager/mode-policy.mjs';

const source = fs.readFileSync('scripts/server-manager/server-manager.mjs', 'utf8');
const policy = new Map(buildDuelModeCommands('GRENADE_ONLY').map((command) => {
  const [name, ...value] = command.split(' ');
  return [name, value.join(' ')];
}));
for (const [name, value] of [
  ['mp_buy_allow_guns', '0'], ['mp_buy_allow_grenades', '0'],
  ['mp_t_default_primary', '0'], ['mp_ct_default_primary', '0'],
  ['mp_t_default_secondary', '0'], ['mp_ct_default_secondary', '0'],
  ['mp_t_default_melee', '0'], ['mp_ct_default_melee', '0'],
  ['mp_t_default_grenades', '0'], ['mp_ct_default_grenades', '0'],
  ['ammo_grenade_limit_total', '12'], ['ammo_grenade_limit_default', '3'],
  ['ammo_grenade_limit_flashbang', '3'], ['mp_weapons_allow_map_placed', '0'],
]) assert.equal(policy.get(name), value, `${name} must enforce grenade-only mode`);

assert.equal(getRuleReapplyDelays('ROUND_START').length, 4, 'rules are re-applied throughout round startup');
assert.equal(getRuleReapplyDelays('GAME_COMMENCING').includes(1000), false);
assert.match(source, /for \(const timer of duelRuleTimers\) clearTimeout\(timer\)/, 'match exit clears delayed mode reapplications');
assert.match(source, /if \(!current \|\| current\.id !== matchId \|\| resultSent\) return/);
assert.doesNotMatch(source, /pulseGrenadeLoadout|grenadeLoadoutPulseTimer/);
assert.match(fs.readFileSync('scripts/server-manager/mode-policy.mjs', 'utf8'), /duelplay_grenade_only \$\{effectiveMode === 'GRENADE_ONLY' \? '1' : '0'\}/);
assert.match(source, /command\('mp_restartgame 1'\)/, 'rules are enforced across a clean round restart');

const pluginPath = 'scripts/cs2-plugins/DuelPlayGrenadeOnly/DuelPlayGrenadeOnly.cs';
const plugin = fs.readFileSync(pluginPath, 'utf8');
assert.match(plugin, /GiveNamedItem/);
assert.match(plugin, /PreventWeaponPickup = true/);
assert.match(plugin, /RegisterEventHandler<EventGrenadeThrown>/, 'only an actual thrown-grenade event advances the spent count');
assert.match(plugin, /Dictionary<ulong, PlayerRoundState>/, 'grenade consumption is tracked independently per SteamID');
assert.match(plugin, /HeThrown = Math\.Min\(GrenadesPerType, HeThrown \+ 1\)/);
assert.match(plugin, /FlashThrown = Math\.Min\(GrenadesPerType, FlashThrown \+ 1\)/);
assert.match(plugin, /SmokeThrown = Math\.Min\(GrenadesPerType, SmokeThrown \+ 1\)/);
assert.match(plugin, /IncendiaryThrown = Math\.Min\(GrenadesPerType, IncendiaryThrown \+ 1\)/);
assert.match(plugin, /RegisterEventHandler<EventRoundStart>/);
assert.match(plugin, /_playerRoundStates\.Clear\(\)/, 'new rounds reset per-player consumption exactly once');
assert.match(plugin, /TimeSpan\.FromMilliseconds\(500\)/, 'duplicate round-start callbacks cannot refill the same round');
assert.match(plugin, /GiveGrenades\(player, "weapon_hegrenade", state\.RemainingHe\)/);
assert.match(plugin, /GiveGrenades\(player, "weapon_flashbang", state\.RemainingFlash\)/);
assert.match(plugin, /GiveGrenades\(player, "weapon_smokegrenade", state\.RemainingSmoke\)/);
assert.match(plugin, /GiveGrenades\(player, incendiary, state\.RemainingIncendiary\)/);
assert.match(plugin, /if \(state\.RemainingTotal == 0\)/);
assert.match(plugin, /state\.KnifeGivenThisLife\)/, 'knife transition is one-shot for the current life');
assert.match(plugin, /player\.GiveNamedItem\("weapon_knife"\)/);
assert.match(plugin, /state\.RemainingTotal != 0/, 'knife is forbidden while any grenade remains');
assert.doesNotMatch(plugin, /RemoveKnifeAndBlockPickup|GEAR_SLOT_KNIFE/);

const lifecycle = fs.readFileSync('lib/match-lifecycle.ts', 'utf8');
assert.ok(lifecycle.includes('function normalizeSteamId(value: unknown)'));
assert.ok(lifecycle.includes('const candidateSteamId = normalizeSteamId(connectedSteamId);'));
const route = fs.readFileSync('app/api/matches/[id]/route.ts', 'utf8');
assert.ok(route.includes('connection-timeout lifecycle failed'));
const matchPage = fs.readFileSync('app/matches/[id]/page.tsx', 'utf8');
assert.ok(matchPage.includes('>START</button>'));
assert.match(source, /CONNECT_TIMEOUT_MS = Number\(process\.env\.DUELPLAY_CONNECTION_TIMEOUT_MS \|\| 5 \* 60 \* 1000\)/);
assert.match(source, /No player connected within 5 minutes/);
assert.ok(fs.existsSync('scripts/cs2-plugins/DuelPlayGrenadeOnly/DuelPlayGrenadeOnly.csproj'));
console.log('GRENADE_ONLY + LIVE 5m technical-win regression: PASS');
