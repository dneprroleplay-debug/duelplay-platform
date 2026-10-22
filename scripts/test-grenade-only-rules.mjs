import fs from 'node:fs';
import assert from 'node:assert/strict';
import { buildDuelModeCommands, getRuleReapplyDelays } from './server-manager/mode-policy.mjs';

const source = fs.readFileSync('scripts/server-manager/server-manager.mjs', 'utf8');
const policy = new Map(buildDuelModeCommands('GRENADE_ONLY').map((command) => {
  const [name, ...value] = command.split(' ');
  return [name, value.join(' ')];
}));
for (const [name, value] of [
  ['mp_startmoney', '0'], ['mp_maxmoney', '0'], ['mp_afterroundmoney', '0'],
  // The shop is closed in GRENADE_ONLY, so vest and helmet are granted for free
  // at spawn instead of being bought.
  ['mp_free_armor', '2'],
  ['mp_buy_allow_guns', '0'], ['mp_buy_allow_grenades', '0'],
  ['mp_t_default_primary', '0'], ['mp_ct_default_primary', '0'],
  ['mp_t_default_secondary', '0'], ['mp_ct_default_secondary', '0'],
  ['mp_t_default_melee', '0'], ['mp_ct_default_melee', '0'],
  ['mp_t_default_grenades', '0'], ['mp_ct_default_grenades', '0'],
  ['ammo_grenade_limit_total', '12'], ['ammo_grenade_limit_default', '3'],
  ['ammo_grenade_limit_flashbang', '3'], ['mp_weapons_allow_map_placed', '0'],
  ['mp_respawn_on_death_t', '1'], ['mp_respawn_on_death_ct', '1'],
  ['mp_respawnwavetime_t', '0'], ['mp_respawnwavetime_ct', '0'],
  ['mp_use_respawn_waves', '0'], ['mp_autokick', '0'],
]) assert.equal(policy.get(name), value, `${name} must enforce grenade-only mode`);

for (const mode of ['SOLO_1V1', 'AWP_ONLY', 'DEAGLE_ONLY', 'KNIFE_ONLY', 'HEADSHOT_ONLY', 'RANDOM_WEAPON', 'FIRST_TO_10']) {
  const rules = new Map(buildDuelModeCommands(mode).map((command) => {
    const [name, ...value] = command.split(' ');
    return [name, value.join(' ')];
  }));
  assert.equal(rules.get('mp_autokick'), '1', `${mode} must restore the normal five-suicide kick`);
}

assert.equal(getRuleReapplyDelays('ROUND_START').length, 4, 'rules are re-applied throughout round startup');
assert.equal(getRuleReapplyDelays('GAME_COMMENCING').includes(1000), false);
assert.match(source, /for \(const timer of duelRuleTimers\) clearTimeout\(timer\)/, 'match exit clears delayed mode reapplications');
assert.match(source, /if \(!current \|\| current\.id !== matchId \|\| resultSent\) return/);
assert.doesNotMatch(source, /pulseGrenadeLoadout|grenadeLoadoutPulseTimer/);
assert.match(fs.readFileSync('scripts/server-manager/mode-policy.mjs', 'utf8'), /duelplay_grenade_only \$\{effectiveMode === 'GRENADE_ONLY' \? '1' : '0'\}/);
assert.match(fs.readFileSync('scripts/server-manager/mode-policy.mjs', 'utf8'), /mp_autokick \$\{grenadeOnly \? '0' : '1'\}/, 'every mode sets mp_autokick explicitly so 0 cannot leak out of GRENADE_ONLY');
assert.match(source, /command\('mp_restartgame 1'\)/, 'rules are enforced across a clean round restart');

const pluginPath = 'scripts/cs2-plugins/DuelPlayGrenadeOnly/DuelPlayGrenadeOnly.cs';
const plugin = fs.readFileSync(pluginPath, 'utf8');
const state = fs.readFileSync('scripts/cs2-plugins/DuelPlayGrenadeOnly/GrenadeRoundState.cs', 'utf8');
assert.match(plugin, /GiveNamedItem/);
assert.match(plugin, /PreventWeaponPickup = true/);
assert.doesNotMatch(plugin, /CaptureAndBlockPickup/, 'pickup blocking is not part of the pre-grant snapshot');
const pickupSnapshot = plugin.slice(plugin.indexOf('private void CapturePickupState'), plugin.indexOf('private static void BlockPickup'));
assert.doesNotMatch(pickupSnapshot, /PreventWeaponPickup\s*=\s*true/, 'CS2 refuses to attach GiveNamedItem items while pickup is blocked, so the snapshot must not block');
const applyLoadout = plugin.slice(plugin.indexOf('private void ApplyLoadout'), plugin.indexOf('private void GiveKnifeIfGrenadesSpent'));
assert.doesNotMatch(applyLoadout, /BlockPickup\(/, 'pickup stays allowed throughout the grenade phase so CS2 can re-select the final grenade');
const knifeGrant = plugin.slice(plugin.indexOf('private void GiveKnifeIfGrenadesSpent'), plugin.indexOf('private static void GiveGrenades'));
assert.ok(knifeGrant.indexOf('AllowPickup(knownPawn ?? pawn);') < knifeGrant.indexOf('BlockPickup(knownPawn ?? pawn);'), 'pickup is blocked only after the knife is granted');
assert.match(plugin, /EnsureRemainingGrenadeDeployed\(player, state, roundId, lifeId, kind\)/, 'a verified throw re-selects a remaining grenade so the final grenade stays throwable');
assert.match(plugin, /ExecuteClientCommandFromServer\(\$"use \{classname\}"\)/, 'the re-deploy mimics the documented use weapon_... bind');
assert.match(plugin, /GrenadeCatalog\.Classname\(target\.Value, player\.TeamNum == \(byte\)CsTeam\.Terrorist\)/, 'the re-deploy target is a real side-specific classname');
assert.match(plugin, /state\.NeedsRedeployAfterThrow\(deployedKind\)/, 'a stale single-kind active weapon still forces a re-select');
assert.match(plugin, /private const int MaxDeployAttempts = 2/, 'one throw sends at most one main re-select plus one delayed retry');
assert.match(plugin, /DeployRetryDelaySeconds = 0\.25f/, 'the retry is delayed instead of repeating within the same frame');
assert.match(plugin, /AddTimer\(DeployRetryDelaySeconds/, 'the single retry is scheduled after the client had time to process the switch');
assert.doesNotMatch(plugin, /Server\.NextFrame\(\(\) => EnsureRemainingGrenadeDeployed/, 'the immediate recursive re-select burst is removed');
assert.match(plugin, /activeIsTarget/, 'the delayed retry is skipped when the engine already reports the target');
assert.match(plugin, /EnsureRemainingGrenadeDeployed\(player, state, roundId, lifeId, null, force: true\)/, 'the safe remainder refresh forces a switch to a remaining grenade');
assert.match(plugin, /ExecuteClientCommandFromServer\("use weapon_knife"\)/, 'a confirmed knife grant switches the client to weapon_knife');
assert.match(plugin, /LogPlayerLifecycle\("spawn-event"/, 'spawn events log the new pawn lifetime for the respawn investigation');
assert.match(plugin, /LogPlayerLifecycle\("death-before-finalize"/, 'death logs state and PawnLifetimeStart before throw reconciliation');
assert.match(plugin, /LogPlayerLifecycle\("death-after-finalize"/, 'death logs the reconciled remainder');
assert.match(plugin, /LogPlayerLifecycle\("life-change"/, 'a new pawn lifetime is detected even if EventPlayerSpawned is missing');
assert.match(plugin, /DescribeKnifeRefusal/, 'a refused knife grant records why it was refused');
assert.match(plugin, /LogMovementProbe/, 'round-start movement is probed with origin, velocity, move type and freeze flags');
assert.match(plugin, /RegisterEventHandler<EventRoundFreezeEnd>/, 'the actual freeze-end event is logged');
assert.match(plugin, /MovementProbeDelaysSeconds = \{ 0f, 0\.5f, 1f, 2f, 5f, 6f, 8f, 10f, 15f \}/, 'movement diagnostics are bounded to fifteen seconds of a round');
assert.match(plugin, /sinceRoundStart=/, 'each movement probe records elapsed time from the actual Round_Start');
assert.match(plugin, /utc=\{Utc:O\}/, 'each movement probe records the actual UTC timestamp');
assert.match(plugin, /if \(state\.RemainingTotal == 0\)[\s\S]*?if \(!state\.HasKnifeBeenGranted\(lifeId\)\) ApplyLoadout\(player\)/, 'an exhausted new life reaches the existing knife path through ApplyLoadout');
assert.match(plugin, /HasKnifeBeenGranted\(lifeId\)/, 'the exhausted-life branch cannot repeatedly request the same life knife');
assert.match(plugin, /ArmPostThrowSwitch\(player, pawn\)/, 'a granted stack and every verified throw arm the engine post-throw switch target');
assert.match(plugin, /SwitchToWeaponAfterThrow\.Raw = handle\.Raw/, 'the post-throw switch points each remaining grenade at itself');
assert.match(plugin, /SavedWeapon\.Raw = handle\.Raw/, 'the saved weapon is aligned with the remaining grenade so the engine has a return target');
assert.match(plugin, /Schema\.IsSchemaFieldNetworked\("CBaseCSGrenade", "m_hSwitchToWeaponAfterThrow"\)/, 'the networked schema field is guarded before SetStateChanged');
assert.match(plugin, /Utilities\.SetStateChanged\(weapon, "CBaseCSGrenade", "m_hSwitchToWeaponAfterThrow"\)/, 'the changed switch field is propagated to the network state');
assert.match(plugin, /ArmSwitchIntervalSeconds/, 'the engine clears the switch on deploy, so it is re-armed on a timer');
assert.ok(plugin.indexOf('ArmPostThrowSwitch(player, pawn);') > -1, 'the arming helper is wired in, not only declared');
assert.ok(plugin.indexOf('AllowPickup(pawn);') > -1 && plugin.indexOf('AllowPickup(pawn);') < plugin.indexOf('player.RemoveWeapons();'), 'pickup is unblocked before every re-grant so a respawn cannot create un-attached items');
assert.match(plugin, /new PickupSnapshot\(lifeId, snapshot\.WasPrevented\)/, 'a new life carries the original pre-plugin pickup state forward');
assert.match(plugin, /GetLifeId\(player\) != lifeId/, 'a deferred throw check never reads a newer pawn inventory');
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
assert.match(state, /HasKnifeBeenGranted\(long lifeId\)/, 'the state exposes whether this life already attempted a knife');
assert.match(state, /CanRefreshLoadoutAfterStrayKnife/, 'stray-knife refresh is fenced by current round, life, pawn, commit and pending throws');
assert.match(state, /NextDeployTarget\(GrenadeKind\? preferred = null\)/, 'the state exposes the remaining grenade to re-deploy after a throw');
assert.match(state, /NeedsRedeployAfterThrow\(GrenadeKind\? activeKind\)/, 'the state decides when the client must be resynced to a remaining grenade');
assert.match(state, /RemainingKinds\(\)/, 'the state reports which grenade kinds still have a throwable entity');
assert.match(state, /class GrenadeCatalog/, 'grenade classnames have a single source of truth shared with the tests');
assert.doesNotMatch(state, /SyncToVerifiedInventory/, 'a partial engine grant is never adopted as the round baseline');
assert.match(plugin, /RegisterEventHandler<EventRoundStart>/);
assert.match(plugin, /RegisterEventHandler<EventPlayerDeath>/, 'death reconciles event-backed throws before respawn');
assert.match(plugin, /state\.ResetForNewRound\(_roundNumber\)/, 'new engine rounds reset per-player consumption');
const roundStart = plugin.slice(plugin.indexOf('RegisterEventHandler<EventRoundStart>'), plugin.indexOf('RegisterEventHandler<EventRoundFreezeEnd>'));
assert.ok(roundStart.indexOf('state.ResetForNewRound(_roundNumber)') < roundStart.indexOf('ApplyLoadout(player)'), 'round state, including the prior knife phase, is reset before the new loadout is issued');
assert.match(plugin, /private static void AllowPickup\(CCSPlayerPawn pawn\)[\s\S]*?PreventWeaponPickup = false/, 'the new-round loadout clears pickup blocking before granting weapons');
assert.ok(plugin.indexOf('AllowPickup(pawn);') < plugin.indexOf('player.RemoveWeapons();'), 'pickup is re-enabled before the full next-round kit is granted');
assert.match(state, /_knifeAttempts\.Clear\(\)/, 'a new round clears prior-life knife attempts');
assert.doesNotMatch(plugin, /DisableAutoDeploy\s*=/, 'GRENADE_ONLY does not mutate DisableAutoDeploy across round transitions');
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
assert.match(plugin, /GrenadeCatalog\.Classname\(GrenadeKind\.Incendiary, player\.TeamNum == \(byte\)CsTeam\.Terrorist\)/, 'T and CT receive their respective incendiaries via the shared catalog');
assert.match(plugin, /RegisterEventHandler<EventPlayerDisconnect>/);
assert.doesNotMatch(plugin, /_playerRoundStates\.Remove\(player\.SteamID\)/, 'a reconnect in the same round cannot refill already-spent grenades');
assert.match(plugin, /override void Unload\(bool hotReload\)/);
assert.match(plugin, /PreventWeaponPickup = snapshot\.WasPrevented/, 'the previous pickup-block value is restored');
assert.match(plugin, /RestoreGrenadeLimits\(\)/, 'plugin disable/unload restores captured grenade cvars');
assert.match(plugin, /state\.RemainingTotal != 0/, 'knife is forbidden while any grenade remains');
assert.match(plugin, /EnsureSpawnLoadout\(@event\.Userid, 0\)/, 'a mid-round respawn retries the loadout for the new life instead of relying on the manager schedule');
assert.match(plugin, /IsSpawnKitReady\(player, lifeId\)/, 'the respawn retry stops as soon as the exact kit is ready');
assert.match(plugin, /IsLoadoutCommitted\(lifeId\)/, 'a committed life is not re-applied by the respawn retry');
assert.match(plugin, /MaxSpawnLoadoutAttempts/, 'respawn loadout retries are bounded');
assert.match(plugin, /RefreshRemainingLoadoutAfterStrayKnife\(player, state, pawn, _roundNumber, lifeId\)/, 'a spawn stray knife uses the safe committed-remainder refresh path');
const safeKnifeRefresh = plugin.slice(plugin.indexOf('private bool RefreshRemainingLoadoutAfterStrayKnife'), plugin.indexOf('private void GiveKnifeIfGrenadesSpent'));
assert.match(safeKnifeRefresh, /player\.RemoveWeapons\(\)/, 'stray-knife cleanup uses the existing engine-managed bulk weapon removal path');
assert.doesNotMatch(safeKnifeRefresh, /RemovePlayerItem|weapon\.Remove\(\)/, 'stray cleanup does not detach/delete an individual weapon entity during PVS');
assert.match(safeKnifeRefresh, /CanRefreshLoadoutAfterStrayKnife/, 'safe refresh is guarded by round, life, pawn, commit and pending-throw state');
assert.match(safeKnifeRefresh, /ToDictionary\(kind => kind, state\.Remaining\)/, 'safe refresh issues only the exact per-type grenade remainder');
assert.match(safeKnifeRefresh, /EnsureRemainingGrenadeDeployed\(player, state, roundId, lifeId, null, force: true\)/, 'the exact remaining grenade is reselected after a safe refresh');
assert.ok(safeKnifeRefresh.indexOf('player.RemoveWeapons()') < safeKnifeRefresh.indexOf('GiveGrenades(player,'), 'the old inventory is cleared before the exact remainder is reissued');
const applyLoadoutBody = plugin.slice(plugin.indexOf('private void ApplyLoadout'), plugin.indexOf('private const int MaxSpawnLoadoutAttempts'));
assert.doesNotMatch(applyLoadoutBody, /StripStrayKnife\(/, 'a respawn grant does not delete the knife while the client is still entering the new life PVS');
const armTimer = plugin.slice(plugin.indexOf('AddTimer(ArmSwitchIntervalSeconds'), plugin.indexOf('Logger.LogInformation("DuelPlay Grenade Only loaded")'));
assert.match(armTimer, /IsLoadoutCommitted\(lifeId\)/, 'the stray knife is not stripped until the current life loadout is committed');
assert.match(armTimer, /if \(state\.RemainingTotal == 0\)[\s\S]*?if \(!state\.HasKnifeBeenGranted\(lifeId\)\) ApplyLoadout\(player\);/, 'the arm timer re-grants the knife for a new exhausted life exactly once');
assert.ok(armTimer.indexOf('ApplyLoadout(player)') < armTimer.indexOf('RefreshRemainingLoadoutAfterStrayKnife(player, state, pawn, _roundNumber, lifeId)'), 'the remaining grenades are committed before stray-knife refresh is allowed');
assert.match(plugin, /mp_respawn_on_death_t 1/, 'the plugin enforces same-round respawn for GRENADE_ONLY even if the map cfg is overwritten');
assert.match(plugin, /mp_respawn_on_death_ct 1/);
assert.match(plugin, /mp_use_respawn_waves 0/);
assert.match(plugin, /RestoreForcedRespawnCvar/, 'respawn cvars are restored only while they still hold the forced value');
assert.match(plugin, /ModuleVersion => "1\.2\.11"/);
assert.match(plugin, /ClosedEconomyCvars[\s\S]*?\("mp_startmoney", 0\)[\s\S]*?\("mp_free_armor", 0\)/, 'the plugin reasserts the closed GRENADE_ONLY economy and armor rules');
assert.match(plugin, /player\.InGameMoneyServices[\s\S]*?money\.Account = 0/, 'the plugin zeroes the live player account after map/runtime money grants');
assert.match(plugin, /pawn\.ArmorValue != 0\) pawn\.ArmorValue = 0/, 'the plugin strips armor granted by map/runtime commands');
assert.match(plugin, /\("mp_buy_anywhere", 0\)[\s\S]*?\("mp_buy_during_immunity", 0\)[\s\S]*?\("mp_buy_allow_guns", 0\)[\s\S]*?\("mp_buy_allow_grenades", 0\)/, 'the plugin closes every buy path, not only the shop timer');
assert.match(plugin, /AddTimer\(ArmSwitchIntervalSeconds[\s\S]*?EnforceClosedEconomyForAll\(\)/, 'the repeated GRENADE_ONLY timer reasserts the closed economy');
const spawnHandler = plugin.slice(plugin.indexOf('RegisterEventHandler<EventPlayerSpawned>'), plugin.indexOf('RegisterEventHandler<EventRoundStart>'));
assert.match(spawnHandler, /EnforceClosedEconomy\(@event\.Userid\)/, 'every spawn re-closes economy and armor before the loadout');
const roundStartHandler = plugin.slice(plugin.indexOf('RegisterEventHandler<EventRoundStart>'), plugin.indexOf('RegisterEventHandler<EventRoundFreezeEnd>'));
assert.match(roundStartHandler, /EnforceClosedEconomyForAll\(\)/, 'round start reasserts the closed economy after map commands');
const freezeEndHandler = plugin.slice(plugin.indexOf('RegisterEventHandler<EventRoundFreezeEnd>'), plugin.indexOf('RegisterEventHandler<EventRoundEnd>'));
assert.match(freezeEndHandler, /EnforceClosedEconomyForAll\(\)/, 'freeze end reasserts the closed economy before buying can matter');
const commencingBlock = source.slice(source.indexOf('World triggered \\"Game_Commencing\\"'), source.indexOf('World triggered \\"Match_Start\\"'));
assert.match(commencingBlock, /applyDuelRules\(current\.mode, current\.weaponModifier\)/, 'the manager reapplies GRENADE_ONLY rules after Game_Commencing');
const roundStartManager = source.slice(source.indexOf('World triggered \\"Round_Start\\"'), source.indexOf('const steamNetLine'));
assert.match(roundStartManager, /applyDuelRules\(current\.mode, current\.weaponModifier\)/, 'the manager reapplies GRENADE_ONLY rules at every Round_Start');
assert.match(state, /IsLoadoutCommitted\(long lifeId\)/, 'the state reports a committed life to the respawn retry');
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
