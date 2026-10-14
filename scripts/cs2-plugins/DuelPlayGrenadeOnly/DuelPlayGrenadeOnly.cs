using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes;
using CounterStrikeSharp.API.Core.Attributes.Registration;
using CounterStrikeSharp.API.Modules.Commands;
using CounterStrikeSharp.API.Modules.Cvars;
using CounterStrikeSharp.API.Modules.Timers;
using CounterStrikeSharp.API.Modules.Utils;
using Microsoft.Extensions.Logging;

namespace DuelPlayGrenadeOnly;

[MinimumApiVersion(80)]
public sealed class DuelPlayGrenadeOnly : BasePlugin
{
    private const int GrenadesPerType = 3;

    private enum GrenadeKind
    {
        He,
        Flash,
        Smoke,
        Incendiary
    }

    private sealed class PlayerRoundState
    {
        public int HeThrown { get; set; }
        public int FlashThrown { get; set; }
        public int SmokeThrown { get; set; }
        public int IncendiaryThrown { get; set; }
        public bool KnifeGivenThisLife { get; set; }

        public int RemainingHe => GrenadesPerType - HeThrown;
        public int RemainingFlash => GrenadesPerType - FlashThrown;
        public int RemainingSmoke => GrenadesPerType - SmokeThrown;
        public int RemainingIncendiary => GrenadesPerType - IncendiaryThrown;
        public int RemainingTotal => RemainingHe + RemainingFlash + RemainingSmoke + RemainingIncendiary;

        public void RecordThrow(GrenadeKind kind)
        {
            switch (kind)
            {
                case GrenadeKind.He: HeThrown = Math.Min(GrenadesPerType, HeThrown + 1); break;
                case GrenadeKind.Flash: FlashThrown = Math.Min(GrenadesPerType, FlashThrown + 1); break;
                case GrenadeKind.Smoke: SmokeThrown = Math.Min(GrenadesPerType, SmokeThrown + 1); break;
                case GrenadeKind.Incendiary: IncendiaryThrown = Math.Min(GrenadesPerType, IncendiaryThrown + 1); break;
            }
        }
    }

    public override string ModuleName => "DuelPlay Grenade Only";
    public override string ModuleVersion => "1.0.0";
    public override string ModuleAuthor => "DuelPlay";
    public override string ModuleDescription => "Enforces DuelPlay GRENADE_ONLY loadout: a bounded grenade set followed by a knife.";

    private bool _enabled;
    private bool _roundStarted;
    private DateTime _lastRoundStateResetAt = DateTime.MinValue;
    private readonly Dictionary<ulong, PlayerRoundState> _playerRoundStates = new();
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
            if (player is null || !IsValidPlayer(player)) return HookResult.Continue;

            ScheduleEnforcement(player);
            return HookResult.Continue;
        });

        RegisterEventHandler<EventRoundStart>((@event, info) =>
        {
            var now = DateTime.UtcNow;
            if (now - _lastRoundStateResetAt < TimeSpan.FromMilliseconds(500)) return HookResult.Continue;

            _lastRoundStateResetAt = now;
            _roundStarted = true;
            _playerRoundStates.Clear();

            if (_enabled)
            {
                foreach (var player in Utilities.GetPlayers().Where(IsValidPlayer))
                {
                    ScheduleEnforcement(player);
                }
            }

            return HookResult.Continue;
        });

        RegisterEventHandler<EventGrenadeThrown>((@event, info) =>
        {
            var player = @event.Userid!;
            if (!_enabled || !_roundStarted || !IsValidPlayer(player)) return HookResult.Continue;
            var kind = GetGrenadeKind(@event.Weapon);
            if (kind is null) return HookResult.Continue;

            var state = GetPlayerRoundState(player);
            state.RecordThrow(kind.Value);
            if (state.RemainingTotal == 0)
            {
                AddTimer(0.10f, () =>
                {
                    if (!_playerRoundStates.TryGetValue(player.SteamID, out var currentState)
                        || !ReferenceEquals(currentState, state)) return;
                    GiveKnifeIfGrenadesSpent(player, state);
                }, TimerFlags.STOP_ON_MAPCHANGE);
            }

            return HookResult.Continue;
        });

        RegisterListener<Listeners.OnMapStart>(_ =>
        {
            _roundStarted = false;
            _lastRoundStateResetAt = DateTime.MinValue;
            _playerRoundStates.Clear();
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

                foreach (var player in Utilities.GetPlayers().Where(IsValidPlayer))
                {
                    ScheduleEnforcement(player);
                }
            }

            ConfigureGrenadeLimits();
            Logger.LogInformation("GRENADE_ONLY enforcement enabled");
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

    private void ScheduleEnforcement(CCSPlayerController player)
    {
        AddTimer(0.10f, () => ApplyLoadout(player), TimerFlags.STOP_ON_MAPCHANGE);
    }

    private void ApplyLoadout(CCSPlayerController player)
    {
        if (!IsValidPlayer(player) || !_enabled) return;

        try
        {
            var pawn = player.PlayerPawn.Value;
            if (pawn is null || !pawn.IsValid) return;

            pawn.WeaponServices!.PreventWeaponPickup = true;
            player.RemoveWeapons();

            var state = GetPlayerRoundState(player);
            state.KnifeGivenThisLife = false;
            if (!_roundStarted) return;

            if (state.RemainingTotal == 0)
            {
                GiveKnifeIfGrenadesSpent(player, state);
                return;
            }

            GiveGrenades(player, "weapon_hegrenade", state.RemainingHe);
            GiveGrenades(player, "weapon_flashbang", state.RemainingFlash);
            GiveGrenades(player, "weapon_smokegrenade", state.RemainingSmoke);

            var incendiary = player.TeamNum == (byte)CsTeam.Terrorist
                ? "weapon_molotov"
                : "weapon_incgrenade";
            GiveGrenades(player, incendiary, state.RemainingIncendiary);

            Logger.LogDebug("Configured GRENADE_ONLY loadout for {SteamId}: {Remaining} grenades remain this round", player.SteamID, state.RemainingTotal);
        }
        catch (Exception ex)
        {
            Logger.LogError(ex, "Failed to apply GRENADE_ONLY loadout to {SteamId}", player.SteamID);
        }
    }

    private void GiveKnifeIfGrenadesSpent(CCSPlayerController player, PlayerRoundState state)
    {
        if (!IsValidPlayer(player) || !_enabled || !_roundStarted || state.RemainingTotal != 0 || state.KnifeGivenThisLife) return;

        try
        {
            var pawn = player.PlayerPawn.Value;
            if (pawn is null || !pawn.IsValid) return;

            pawn.WeaponServices!.PreventWeaponPickup = true;
            player.GiveNamedItem("weapon_knife");
            state.KnifeGivenThisLife = true;
            Logger.LogDebug("Granted GRENADE_ONLY knife to {SteamId} after all round grenades were thrown", player.SteamID);
        }
        catch (Exception ex)
        {
            Logger.LogError(ex, "Failed to grant GRENADE_ONLY knife to {SteamId}", player.SteamID);
        }
    }

    private static void GiveGrenades(CCSPlayerController player, string grenade, int count)
    {
        for (var i = 0; i < count; i++)
        {
            player.GiveNamedItem(grenade);
        }
    }

    private PlayerRoundState GetPlayerRoundState(CCSPlayerController player)
    {
        if (!_playerRoundStates.TryGetValue(player.SteamID, out var state))
        {
            state = new PlayerRoundState();
            _playerRoundStates[player.SteamID] = state;
        }

        return state;
    }

    private static GrenadeKind? GetGrenadeKind(string weapon)
    {
        var normalized = weapon.Trim().ToLowerInvariant();
        if (!normalized.StartsWith("weapon_", StringComparison.Ordinal)) normalized = $"weapon_{normalized}";

        return normalized switch
        {
            "weapon_hegrenade" => GrenadeKind.He,
            "weapon_flashbang" => GrenadeKind.Flash,
            "weapon_smokegrenade" => GrenadeKind.Smoke,
            "weapon_molotov" or "weapon_incgrenade" => GrenadeKind.Incendiary,
            _ => null
        };
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
