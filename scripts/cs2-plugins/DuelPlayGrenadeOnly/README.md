# DuelPlay Grenade Only plugin

CounterStrikeSharp plugin for the DuelPlay `GRENADE_ONLY` mode.

Behavior when `duelplay_grenade_only 1` is enabled:

- waits for an active round and a live player before changing that player's inventory;
- blocks weapon pickup;
- gives each player a round-limited set: 3 HE + 3 flash + 3 smoke + 3 molotov/incendiary = 12 grenades;
- checks the CounterStrikeSharp item-creation result and counts the actual inventory after the grant; a failed/short grant is logged and never treated as an exhausted kit;
- counts a throw only when the matching event is confirmed by an inventory decrease on the next CounterStrikeSharp game frame; duplicate callbacks cannot spend the same item twice;
- gives that player one knife per life only after all 12 allotted grenades are event-backed as spent and the grenade inventory is empty;
- preserves only unthrown grenades after death/respawn and adapts the remaining incendiary to the player's current side;
- resets each player's throw counts using the engine round identity (not a timing window); deferred checks carry a round generation and are discarded after a round transition;
- makes duplicate spawn events idempotent within one pawn lifetime, while a genuine respawn can restore only the remaining round quota;
- keeps the per-round entitlement across a disconnect, so a reconnect inside the same round can only be given the grenades that were not thrown yet (never a refilled kit); the round-start reset still clears it for the next round;
- restores the prior pickup-block state and grenade limits when the mode is disabled or the plugin unloads;
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
