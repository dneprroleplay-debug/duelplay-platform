# DuelPlay Grenade Only plugin

CounterStrikeSharp plugin for the DuelPlay `GRENADE_ONLY` mode.

Behavior when `duelplay_grenade_only 1` is enabled:

- waits for an active round and a live player before changing that player's inventory;
- leaves weapon pickup enabled during the grenade phase, then blocks it only after the knife is granted (CS2 refuses to re-select or attach an item while pickup is blocked; blocking earlier left the final remaining grenade unthrowable);
- gives each player a round-limited set: 3 HE + 3 flash + 3 smoke + 3 molotov/incendiary = 12 grenades;
- checks the CounterStrikeSharp item-creation result and counts the actual inventory after the grant; a failed/short grant is logged and never treated as an exhausted kit;
- counts a throw only when the matching event is confirmed by an inventory decrease on the next CounterStrikeSharp game frame; duplicate callbacks cannot spend the same item twice;
- gives that player one knife per life only after all 12 allotted grenades are event-backed as spent and the grenade inventory is empty;
- preserves only unthrown grenades after death/respawn and adapts the remaining incendiary to the player's current side; the server manager respawns the player inside the same round (`mp_respawn_on_death_t/ct 1`), and the plugin re-asserts those cvars while enabled because `gamemode_competitive*.cfg` can be exec'd again after the map cfg and overwrite them;
- retries the new life's loadout on a short bounded timer after `EventPlayerSpawned`, because a mid-round respawn can fire before the engine has a live pawn and nothing else re-applies the kit during the round; the retry stops as soon as that exact remainder is committed (or, once the kit is spent, the knife is verified), so a respawn that lands between the manager's scheduled re-applies still receives the remaining grenades instead of only the engine's default knife;
- never refreshes a stray spawn melee before the current life's exact remaining loadout is committed; once committed, a stray knife is cleared through the same engine-managed `RemoveWeapons` path used by loadout grants, then only the exact unthrown remainder is re-issued. It does not individually delete a weapon entity during the pawn's PVS transition;
- removes a melee weapon CS2 re-adds on spawn while grenades remain (`mp_*_default_melee 0` does not stop the engine from equipping one), so no knife is selectable before the kit is spent; the real knife is granted once all 12 grenades are thrown and is never stripped;
- arms the engine post-throw switch (`m_hSwitchToWeaponAfterThrow`, plus the player's saved weapon) on every remaining grenade so the client always has a valid weapon to switch to after a throw; `GiveNamedItem` does not set this field the way a normally acquired grenade stack does, and the engine clears it on each deploy, so it is re-armed after the grant, after every verified throw and on a short timer;
- disables CS2's five-suicide kick only while `GRENADE_ONLY` is active (`mp_autokick 0`); every other mode explicitly restores `mp_autokick 1` so the value cannot leak across a mode change;
- resets each player's throw counts using the engine round identity (not a timing window); deferred checks carry a round generation and are discarded after a round transition;
- makes duplicate spawn events idempotent within one pawn lifetime, while a genuine respawn can restore only the remaining round quota;
- keeps the per-round entitlement across a disconnect, so a reconnect inside the same round can only be given the grenades that were not thrown yet (never a refilled kit); the round-start reset still clears it for the next round;
- re-selects a remaining grenade by its real classname (`use weapon_...`, the documented bind) whenever the client would otherwise lose sync after a throw: with two or more grenade types left the engine auto-switches correctly, but with a single type left and ammo still remaining it has no other grenade to switch to and the client stops sending throw commands even though the server still reports the stale thrown grenade as active; one throw sends at most one command plus one delayed (`0.25 s`) retry that is skipped when the engine already reports the target as active; a removed stray knife always forces one switch, and a confirmed knife grant switches the client to `weapon_knife`; the side-specific incendiary classname comes from one shared catalog;
- writes temporary lifecycle diagnostics (death before/after throw reconciliation, `EventPlayerSpawned`, observed `PawnLifetimeStart` changes, knife-refusal reason) and a bounded movement probe at `Round_Start`, the actual `Round_Freeze_End`, and +6/+8/+10/+15 seconds (origin, velocity, move type, freeze flags); these exist only to answer the open respawn/freeze questions in a live match and are removed once confirmed;
- restores the prior pickup-block state and grenade limits when the mode is disabled or the plugin unloads; the forced respawn cvars are restored only while they still hold the forced value, so a newer mode policy is never overwritten;
- does not use `sv_cheats`, `ent_remove_all`, or `sv_infinite_ammo`.

Thrown grenades are not replenished within a round; each new round resets the count and re-issues the full set. Repeated enable commands do not grant another loadout.

The DuelPlay server manager enables this mode with `duelplay_grenade_only 1` and disables it with `duelplay_grenade_only 0`.

## Build

Requires the .NET SDK compatible with the installed CounterStrikeSharp API. The current pinned package is `CounterStrikeSharp.API 1.0.374`.

```powershell
dotnet build .\DuelPlayGrenadeOnly.csproj --configuration Release
```

CounterStrikeSharp plugin binaries are installed under each CS2 instance root (`CS2_DIR`), for example `/home/ubuntu/cs2/instances/cs2-1/root`:

`$CS2_DIR/csgo/addons/counterstrikesharp/plugins/DuelPlayGrenadeOnly/`

Copy the build output DLL and its `.deps.json` (and `.pdb` when produced) into that folder on **every** registered instance so all servers run the same plugin build. Do not copy the DLL into the shared `/home/ubuntu/cs2/game` tree (no instance loads plugins from there) or to the `counterstrikesharp/plugins/` root, and delete any legacy root-level `DuelPlayGrenadeOnly.dll`.

## Local state tests

The state-machine checks use only the .NET SDK and no game server:

```powershell
dotnet run --project ..\DuelPlayGrenadeOnly.Tests\DuelPlayGrenadeOnly.Tests.csproj
```

These tests do not replace a live CS2 check of engine grenade limits, inventory behavior, or event ordering.
