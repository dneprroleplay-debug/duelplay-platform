using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes;
using CounterStrikeSharp.API.Core.Attributes.Registration;
using CounterStrikeSharp.API.Modules.Commands;
using CounterStrikeSharp.API.Modules.Cvars;
using CounterStrikeSharp.API.Modules.Timers;

namespace DuelPlayGrenadeOnly;

[MinimumApiVersion(80)]
public sealed class DuelPlayGrenadeOnly : BasePlugin
{
    private const int GrenadesPerType = 3;

    private static readonly string[] CommonGrenades =
    [
        "weapon_hegrenade",
        "weapon_flashbang",
        "weapon_smokegrenade"
    ];

    public override string ModuleName => "DuelPlay Grenade Only";
    public override string ModuleVersion => "1.0.0";
    public override string ModuleAuthor => "DuelPlay";
    public override string ModuleDescription => "Enforces DuelPlay GRENADE_ONLY loadout: no knife/weapons and 12 grenades per spawn.";

    private bool _enabled;
    private int? _previousGrenadeTotal;
    private int? _previousGrenadeDefault;
    private int? _previousFlashbangLimit;

    public override void Load(bool hotReload)
    {
        // Internal server-only control used by the DuelPlay server manager.
        // Players must never be able to toggle this mode themselves.

        RegisterEventHandler<EventPlayerSpawned>((@event, info) =>
        {
            if (!_enabled) return HookResult.Continue;

            var player = @event.Userid;
            if (!IsValidPlayer(player)) return HookResult.Continue;

            ScheduleEnforcement(player, giveLoadout: true);
            return HookResult.Continue;
        });

        Logger.LogInformation("DuelPlay Grenade Only loaded");
    }

    [ConsoleCommand("duelplay_grenade_only", "Enable or disable DuelPlay GRENADE_ONLY enforcement.")]
    [CommandHelper(minArgs: 1, usage: "<0|1>", whoCanExecute: CommandUsage.SERVER_ONLY)]
    public void OnToggleCommand(CCSPlayerController? caller, CommandInfo command)
    {
        if (command.ArgCount < 2)
        {
            command.ReplyToCommand("Usage: duelplay_grenade_only <0|1>");
            return;
        }

        var value = command.GetArg(1);
        var enable = value == "1" || value.Equals("true", StringComparison.OrdinalIgnoreCase);

        if (enable)
        {
            if (!_enabled)
            {
                CaptureGrenadeLimits();
                _enabled = true;
            }

            ConfigureGrenadeLimits();
            Logger.LogInformation("GRENADE_ONLY enforcement enabled");
            foreach (var player in Utilities.GetPlayers().Where(IsValidPlayer))
            {
                ScheduleEnforcement(player, giveLoadout: true);
            }
        }
        else
        {
            if (_enabled)
            {
                _enabled = false;
                RestoreGrenadeLimits();
            }

            Logger.LogInformation("GRENADE_ONLY enforcement disabled");
            foreach (var player in Utilities.GetPlayers().Where(IsValidPlayer))
            {
                RestorePickupState(player);
            }
        }
    }

    private void ScheduleEnforcement(CCSPlayerController player, bool giveLoadout)
    {
        AddTimer(0.10f, () => ApplyLoadout(player, giveLoadout), TimerFlags.STOP_ON_MAPCHANGE);
        AddTimer(0.60f, () => RemoveKnifeAndBlockPickup(player), TimerFlags.STOP_ON_MAPCHANGE);
    }

    private void ApplyLoadout(CCSPlayerController player, bool giveLoadout)
    {
        if (!IsValidPlayer(player) || !_enabled) return;

        try
        {
            var pawn = player.PlayerPawn.Value;
            if (pawn is null || !pawn.IsValid) return;

            pawn.WeaponServices!.PreventWeaponPickup = true;
            pawn.ItemServices!.RemoveWeapons();

            if (!giveLoadout) return;

            foreach (var grenade in CommonGrenades)
            {
                for (var i = 0; i < GrenadesPerType; i++)
                {
                    pawn.ItemServices.GiveNamedItem<CBasePlayerWeapon>(grenade);
                }
            }

            var incendiary = player.TeamNum == (byte)CsTeam.Terrorist
                ? "weapon_molotov"
                : "weapon_incgrenade";

            for (var i = 0; i < GrenadesPerType; i++)
            {
                pawn.ItemServices.GiveNamedItem<CBasePlayerWeapon>(incendiary);
            }

            Logger.LogDebug("Configured GRENADE_ONLY loadout for {SteamId}", player.SteamID);
        }
        catch (Exception ex)
        {
            Logger.LogError(ex, "Failed to apply GRENADE_ONLY loadout to {SteamId}", player.SteamID);
        }
    }

    private void RemoveKnifeAndBlockPickup(CCSPlayerController player)
    {
        if (!IsValidPlayer(player) || !_enabled) return;

        try
        {
            var pawn = player.PlayerPawn.Value;
            if (pawn is null || !pawn.IsValid) return;

            pawn.WeaponServices!.PreventWeaponPickup = true;
            player.RemoveItemBySlot(gear_slot_t.GEAR_SLOT_KNIFE);
        }
        catch (Exception ex)
        {
            Logger.LogError(ex, "Failed to remove GRENADE_ONLY knife from {SteamId}", player.SteamID);
        }
    }

    private void CaptureGrenadeLimits()
    {
        _previousGrenadeTotal = ReadConVarInt("ammo_grenade_limit_total");
        _previousGrenadeDefault = ReadConVarInt("ammo_grenade_limit_default");
        _previousFlashbangLimit = ReadConVarInt("ammo_grenade_limit_flashbang");
    }

    private static int? ReadConVarInt(string name)
    {
        var cvar = ConVar.Find(name);
        if (cvar is null) return null;

        try
        {
            return cvar.GetPrimitiveValue<int>();
        }
        catch
        {
            return null;
        }
    }

    private static void ConfigureGrenadeLimits()
    {
        Server.ExecuteCommand("ammo_grenade_limit_total 12");
        Server.ExecuteCommand("ammo_grenade_limit_default 3");
        Server.ExecuteCommand("ammo_grenade_limit_flashbang 3");
    }

    private void RestoreGrenadeLimits()
    {
        if (_previousGrenadeTotal.HasValue)
            Server.ExecuteCommand($"ammo_grenade_limit_total {_previousGrenadeTotal.Value}");
        if (_previousGrenadeDefault.HasValue)
            Server.ExecuteCommand($"ammo_grenade_limit_default {_previousGrenadeDefault.Value}");
        if (_previousFlashbangLimit.HasValue)
            Server.ExecuteCommand($"ammo_grenade_limit_flashbang {_previousFlashbangLimit.Value}");

        _previousGrenadeTotal = null;
        _previousGrenadeDefault = null;
        _previousFlashbangLimit = null;
    }

    private static void RestorePickupState(CCSPlayerController player)
    {
        try
        {
            var pawn = player.PlayerPawn.Value;
            if (pawn is null || !pawn.IsValid) return;
            pawn.WeaponServices!.PreventWeaponPickup = false;
        }
        catch
        {
            // Ignore stale player handles during mode transitions.
        }
    }

    private static bool IsValidPlayer(CCSPlayerController? player)
    {
        if (player is null || !player.IsValid || player.IsBot) return false;
        var pawn = player.PlayerPawn.Value;
        return pawn is not null && pawn.IsValid;
    }
}
