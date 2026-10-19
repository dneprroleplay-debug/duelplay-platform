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
const state = fs.readFileSync('scripts/cs2-plugins/DuelPlayGrenadeOnly/GrenadeRoundState.cs', 'utf8');
assert.match(plugin, /GiveNamedItem/);
assert.match(plugin, /PreventWeaponPickup = true/);
assert.match(plugin, /RegisterEventHandler<EventGrenadeThrown>/, 'only an actual thrown-grenade event advances the spent count');
assert.match(plugin, /Dictionary<ulong, GrenadeRoundState>/, 'grenade consumption is tracked independently per SteamID');
assert.match(state, /GrenadesPerType = 3/);
assert.match(state, /TryBeginLoadout\(long eventRoundId, long lifeId, byte team\)/, 'same-life/team duplicate spawn events cannot reserve another set');
assert.match(state, /CompleteLoadout\(long eventRoundId, long lifeId, IReadOnlyDictionary<GrenadeKind, int> verifiedInventory\)/, 'a loadout is committed only after the complete grant is verified');
assert.match(state, /AbortLoadout\(long eventRoundId, long lifeId\)/, 'a short or failed grant is aborted instead of adopted as ground truth');
assert.match(state, /TryRecordThrow\(long eventRoundId, GrenadeKind kind, int observedInventory, out int consumed\)/, 'only an event-backed inventory decrease spends bounded round allowance');
assert.match(state, /NoteThrow\(long eventRoundId, GrenadeKind kind\)/, 'each throw callback is noted before the deferred inventory check');
assert.match(state, /FinalizePendingThrows\(long eventRoundId\)/, 'a death finalizes unverified throw callbacks instead of refilling them');
assert.match(state, /TryBeginKnife\(long eventRoundId, long lifeId\)/, 'knife attempt is once per life and requires an exhausted allowance');
assert.doesNotMatch(state, /SyncToVerifiedInventory/, 'a partial engine grant is never adopted as the round baseline');
assert.match(plugin, /RegisterEventHandler<EventRoundStart>/);
assert.match(plugin, /RegisterEventHandler<EventPlayerDeath>/, 'death reconciles event-backed throws before respawn');
assert.match(plugin, /state\.ResetForNewRound\(_roundNumber\)/, 'new engine rounds reset per-player consumption');
assert.match(plugin, /RoundStartRoundNumber/, 'engine round identity replaces timing heuristics');
assert.match(plugin, /Server\.NextFrame\(/, 'post-throw inventory checks are deferred on the CSS game thread');
assert.match(plugin, /roundId != _roundNumber/, 'deferred prior-round callbacks cannot mutate the current round');
assert.match(plugin, /TryRecordThrow\(roundId, kind, actualCount/, 'throw events are cross-checked against actual inventory');
assert.match(plugin, /NoteThrow\(_roundNumber, kind\.Value\)/, 'the throw event is authoritative even if inventory is unreadable');
assert.match(plugin, /if \(!_enabled \|\| !_roundStarted \|\| !IsLivePlayer\(player\)/, 'round/player checks happen before any loadout mutation');
assert.ok(plugin.indexOf('if (!_enabled || !_roundStarted || !IsLivePlayer(player)') < plugin.indexOf('player.RemoveWeapons()'), 'RemoveWeapons is after active-round and live-pawn checks');
assert.match(plugin, /GiveGrenades\(player, "weapon_hegrenade", expected\[GrenadeKind\.He\]\)/);
assert.match(plugin, /GiveGrenades\(player, "weapon_flashbang", expected\[GrenadeKind\.Flash\]\)/);
assert.match(plugin, /GiveGrenades\(player, "weapon_smokegrenade", expected\[GrenadeKind\.Smoke\]\)/);
assert.match(plugin, /GiveGrenades\(player, incendiary, expected\[GrenadeKind\.Incendiary\]\)/);
assert.match(plugin, /GiveNamedItem<CBasePlayerWeapon>/, 'the checked generic CSS API overload is used');
assert.match(plugin, /CountGrenades\(pawn\)/, 'actual inventory is verified after grant');
assert.match(plugin, /services\.Ammo/, 'grenade counts come from the player ammo pool, not weapon entities');
assert.match(plugin, /PrimaryAmmoType/, 'the ammo index is derived from the weapon VData instead of a magic constant');
assert.match(plugin, /state\.CompleteLoadout\(_roundNumber, lifeId, expected\)/, 'the full grant is committed only after verification');
assert.match(plugin, /state\.AbortLoadout\(_roundNumber, lifeId\)/, 'an incomplete grant aborts the loadout so the round can retry');
assert.match(plugin, /MaxLoadoutAttempts/, 'grant retries are bounded');
assert.doesNotMatch(plugin, /cannot identify the active game round/, 'the round and its loadout are not blocked when the engine round identity is unreadable');
assert.match(plugin, /TeamNum == \(byte\)CsTeam\.Terrorist \? "weapon_molotov" : "weapon_incgrenade"/, 'T and CT receive their respective incendiaries');
assert.match(plugin, /RegisterEventHandler<EventPlayerDisconnect>/);
assert.doesNotMatch(plugin, /_playerRoundStates\.Remove\(player\.SteamID\)/, 'a reconnect in the same round cannot refill already-spent grenades');
assert.match(plugin, /override void Unload\(bool hotReload\)/);
assert.match(plugin, /PreventWeaponPickup = snapshot\.WasPrevented/, 'the previous pickup-block value is restored');
assert.match(plugin, /RestoreGrenadeLimits\(\)/, 'plugin disable/unload restores captured grenade cvars');
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
