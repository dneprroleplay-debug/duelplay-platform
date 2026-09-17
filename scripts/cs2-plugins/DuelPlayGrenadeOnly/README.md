# DuelPlay Grenade Only plugin

CounterStrikeSharp plugin for the DuelPlay `GRENADE_ONLY` mode.

Behavior when `duelplay_grenade_only 1` is enabled:

- removes the player's weapons on spawn;
- blocks weapon pickup;
- removes the knife after spawn;
- gives 3 HE + 3 flash + 3 smoke + 3 molotov/incendiary = 12 grenades per spawn;
- does not use `sv_cheats`, `ent_remove_all`, or `sv_infinite_ammo`.

Grenades are not replenished after being thrown. A fresh set is given on the next player spawn.

The DuelPlay server manager enables this mode with `duelplay_grenade_only 1` and disables it with `duelplay_grenade_only 0`.

## Build

Requires the .NET SDK compatible with the installed CounterStrikeSharp API. The current pinned package is `CounterStrikeSharp.API 1.0.374`.

```powershell
dotnet build .\DuelPlayGrenadeOnly.csproj --configuration Release
```

CounterStrikeSharp plugin binaries are installed under:

`<server>/game/csgo/addons/counterstrikesharp/plugins/DuelPlayGrenadeOnly/`

Copy the build output DLL (and its `.deps.json` / `.pdb` when produced) into that folder according to the installed CounterStrikeSharp version.
