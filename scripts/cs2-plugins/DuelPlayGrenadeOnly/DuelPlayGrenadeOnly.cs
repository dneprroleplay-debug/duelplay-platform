using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes;
using CounterStrikeSharp.API.Core.Attributes.Registration;
using CounterStrikeSharp.API.Modules.Commands;
using CounterStrikeSharp.API.Modules.Cvars;
using CounterStrikeSharp.API.Modules.Extensions;
using CounterStrikeSharp.API.Modules.Utils;
using Microsoft.Extensions.Logging;

namespace DuelPlayGrenadeOnly;

[MinimumApiVersion(80)]
public sealed class DuelPlayGrenadeOnly : BasePlugin
{
    private sealed record PickupSnapshot(long LifeId, bool WasPrevented);
    private readonly record struct EngineRoundIdentity(int TotalRoundsPlayed, int RoundStartNumber, byte RoundStartCount);

    public override string ModuleName => "DuelPlay Grenade Only";
    public override string ModuleVersion => "1.1.0";
    public override string ModuleAuthor => "DuelPlay";
    public override string ModuleDescription => "Grants a verified round-limited grenade set, then one knife per life.";

    private bool _enabled;
    private bool _roundStarted;
    private long _roundNumber;
    private EngineRoundIdentity? _engineRoundIdentity;
    private readonly Dictionary<ulong, GrenadeRoundState> _playerRoundStates = new();
    private readonly Dictionary<(long RoundId, ulong SteamId, GrenadeKind Kind), int> _pendingThrowChecks = new();
    private readonly Dictionary<ulong, PickupSnapshot> _pickupSnapshots = new();
    private int? _previousGrenadeTotal;
    private int? _previousGrenadeDefault;
    private int? _previousFlashbangLimit;

    public override void Load(bool hotReload)
    {
        RegisterEventHandler<EventPlayerSpawned>((@event, info) =>
        {
            if (_enabled) ApplyLoadout(@event.Userid);
            return HookResult.Continue;
        });

        RegisterEventHandler<EventRoundStart>((@event, info) =>
        {
            var engineRoundIdentity = GetEngineRoundIdentity();
            if (engineRoundIdentity is null)
            {
                _roundStarted = false;
                Logger.LogError("GRENADE_ONLY cannot identify the active game round; loadouts and knife grants are blocked");
                return HookResult.Continue;
            }
            if (_engineRoundIdentity == engineRoundIdentity) return HookResult.Continue;

            _engineRoundIdentity = engineRoundIdentity;
            _roundStarted = true;
            _roundNumber++;
            _pendingThrowChecks.Clear();
            foreach (var state in _playerRoundStates.Values) state.ResetForNewRound(_roundNumber);
            Logger.LogInformation("GRENADE_ONLY round {Round} started; player grenade entitlements reset", _roundNumber);

            if (_enabled)
            {
                foreach (var player in Utilities.GetPlayers().Where(IsLivePlayer)) ApplyLoadout(player);
            }

            return HookResult.Continue;
        });

        RegisterEventHandler<EventRoundEnd>((@event, info) =>
        {
            var engineRoundIdentity = GetEngineRoundIdentity();
            if (engineRoundIdentity is not null && engineRoundIdentity != _engineRoundIdentity) return HookResult.Continue;
            _roundStarted = false;
            Logger.LogInformation("GRENADE_ONLY round {Round} ended", _roundNumber);
            return HookResult.Continue;
        });

        RegisterEventHandler<EventGrenadeThrown>((@event, info) =>
        {
            var player = @event.Userid;
            if (!_enabled || !_roundStarted || player is null || !player.IsValid) return HookResult.Continue;

            var kind = GetGrenadeKind(@event.Weapon);
            if (kind is null || !_playerRoundStates.ContainsKey(player.SteamID)) return HookResult.Continue;
            QueueThrowInventoryCheck(player, kind.Value, _roundNumber);
            return HookResult.Continue;
        });

        RegisterEventHandler<EventPlayerTeam>((@event, info) =>
        {
            var player = @event.Userid;
            var roundId = _roundNumber;
            if (!_enabled || !_roundStarted || player is null || !player.IsValid) return HookResult.Continue;
            Server.NextFrame(() =>
            {
                if (!_enabled || !_roundStarted || roundId != _roundNumber || !player.IsValid) return;
                ApplyLoadout(player);
            });
            return HookResult.Continue;
        });

        RegisterEventHandler<EventPlayerDisconnect>((@event, info) =>
        {
            var player = @event.Userid;
            if (player is not null)
            {
                _playerRoundStates.Remove(player.SteamID);
                _pickupSnapshots.Remove(player.SteamID);
            }
            return HookResult.Continue;
        });

        RegisterListener<Listeners.OnMapStart>(_ =>
        {
            RestoreAllPickupStates();
            _roundStarted = false;
            _engineRoundIdentity = null;
            _pendingThrowChecks.Clear();
            _playerRoundStates.Clear();
            Logger.LogInformation("GRENADE_ONLY map state reset");
        });

        Logger.LogInformation("DuelPlay Grenade Only loaded");
    }

    public override void Unload(bool hotReload)
    {
        _enabled = false;
        RestoreAllPickupStates();
        RestoreGrenadeLimits();
        _roundStarted = false;
        _playerRoundStates.Clear();
        Logger.LogInformation("DuelPlay Grenade Only unloaded; mode state restored");
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
        if (value is not ("0" or "1") && !value.Equals("true", StringComparison.OrdinalIgnoreCase) && !value.Equals("false", StringComparison.OrdinalIgnoreCase))
        {
            command.ReplyToCommand("Usage: duelplay_grenade_only <0|1>");
            return;
        }

        var enable = value == "1" || value.Equals("true", StringComparison.OrdinalIgnoreCase);
        if (enable)
        {
            if (!_enabled)
            {
                CaptureGrenadeLimits();
                _enabled = true;
            }

            ConfigureGrenadeLimits();
            Logger.LogInformation("GRENADE_ONLY enforcement enabled for round {Round}", _roundNumber);
            foreach (var player in Utilities.GetPlayers().Where(IsLivePlayer)) ApplyLoadout(player);
            return;
        }

        if (_enabled)
        {
            _enabled = false;
            RestoreAllPickupStates();
            RestoreGrenadeLimits();
        }
        Logger.LogInformation("GRENADE_ONLY enforcement disabled");
    }

    private void ApplyLoadout(CCSPlayerController? player)
    {
        // EventPlayerSpawned can precede EventRoundStart. Never mutate the spawn loadout
        // until the round is active; EventRoundStart will apply it to already-live players.
        if (!_enabled || !_roundStarted || !IsLivePlayer(player) || !TryGetLivePawn(player!, out var pawn)) return;
        if (!EnsureGrenadeLimits(player!)) return;

        var lifeId = GetLifeId(player!);
        if (!_playerRoundStates.TryGetValue(player!.SteamID, out var state))
        {
            state = new GrenadeRoundState(_roundNumber);
            _playerRoundStates[player.SteamID] = state;
        }

        CaptureAndBlockPickup(player, pawn, lifeId);
        if (state.RemainingTotal == 0)
        {
            GiveKnifeIfGrenadesSpent(player, state, lifeId, pawn);
            return;
        }

        if (!state.TryBeginLoadout(_roundNumber, lifeId, player.TeamNum)) return;

        try
        {
            // This is reached only for a live pawn during an active round, with required
            // game limits verified. Failed item creation is logged and never becomes a knife.
            player.RemoveWeapons();
            var incendiary = player.TeamNum == (byte)CsTeam.Terrorist ? "weapon_molotov" : "weapon_incgrenade";
            var expected = new Dictionary<GrenadeKind, int>
            {
                [GrenadeKind.He] = state.Remaining(GrenadeKind.He),
                [GrenadeKind.Flash] = state.Remaining(GrenadeKind.Flash),
                [GrenadeKind.Smoke] = state.Remaining(GrenadeKind.Smoke),
                [GrenadeKind.Incendiary] = state.Remaining(GrenadeKind.Incendiary),
            };

            GiveGrenades(player, "weapon_hegrenade", expected[GrenadeKind.He]);
            GiveGrenades(player, "weapon_flashbang", expected[GrenadeKind.Flash]);
            GiveGrenades(player, "weapon_smokegrenade", expected[GrenadeKind.Smoke]);
            GiveGrenades(player, incendiary, expected[GrenadeKind.Incendiary]);

            var actual = CountGrenades(pawn);
            if (Enum.GetValues<GrenadeKind>().Any(kind => actual[kind] != expected[kind]))
            {
                Logger.LogError(
                    "GRENADE_ONLY loadout verification failed for SteamID {SteamId}, round {Round}. Expected HE={ExpectedHe} flash={ExpectedFlash} smoke={ExpectedSmoke} incendiary={ExpectedIncendiary}; actual HE={He} flash={Flash} smoke={Smoke} incendiary={Incendiary}. No knife will be granted.",
                    player.SteamID, _roundNumber, expected[GrenadeKind.He], expected[GrenadeKind.Flash], expected[GrenadeKind.Smoke], expected[GrenadeKind.Incendiary],
                    actual[GrenadeKind.He], actual[GrenadeKind.Flash], actual[GrenadeKind.Smoke], actual[GrenadeKind.Incendiary]);
                return;
            }

            foreach (var kind in Enum.GetValues<GrenadeKind>()) state.SetVerifiedInventory(_roundNumber, kind, actual[kind]);

            Logger.LogInformation(
                "GRENADE_ONLY loadout verified for SteamID {SteamId}, round {Round}: HE={He} flash={Flash} smoke={Smoke} incendiary={Incendiary}",
                player.SteamID, _roundNumber, actual[GrenadeKind.He], actual[GrenadeKind.Flash], actual[GrenadeKind.Smoke], actual[GrenadeKind.Incendiary]);
        }
        catch (Exception ex)
        {
            if (TryGetValidPawn(player, out var failedPawn))
            {
                var actual = CountGrenades(failedPawn);
                Logger.LogError(ex,
                    "GRENADE_ONLY loadout failed for SteamID {SteamId}, round {Round}; actual inventory HE={He} flash={Flash} smoke={Smoke} incendiary={Incendiary}; no knife will be granted",
                    player.SteamID, _roundNumber, actual[GrenadeKind.He], actual[GrenadeKind.Flash], actual[GrenadeKind.Smoke], actual[GrenadeKind.Incendiary]);
            }
            else Logger.LogError(ex, "GRENADE_ONLY loadout failed for SteamID {SteamId}, round {Round}; inventory unavailable, no knife will be granted", player.SteamID, _roundNumber);
        }
    }

    private void GiveKnifeIfGrenadesSpent(CCSPlayerController player, GrenadeRoundState state, long lifeId, CCSPlayerPawn? knownPawn = null)
    {
        if (!_enabled || !_roundStarted || state.RemainingTotal != 0 || !IsLivePlayer(player)
            || state.RoundId != _roundNumber || !TryGetLivePawn(player, out var pawn)) return;

        var actual = CountGrenades(pawn);
        if (actual.Values.Any(count => count != 0))
        {
            Logger.LogError(
                "GRENADE_ONLY knife blocked for SteamID {SteamId}, round {Round}: quota is spent but inventory remains HE={He} flash={Flash} smoke={Smoke} incendiary={Incendiary}",
                player.SteamID, _roundNumber, actual[GrenadeKind.He], actual[GrenadeKind.Flash], actual[GrenadeKind.Smoke], actual[GrenadeKind.Incendiary]);
            return;
        }
        if (!state.TryBeginKnife(_roundNumber, lifeId)) return;

        try
        {
            CaptureAndBlockPickup(player, knownPawn ?? pawn, lifeId);
            if (CountWeapon(pawn, "weapon_knife") == 0)
            {
                var knife = player.GiveNamedItem<CBasePlayerWeapon>("weapon_knife");
                if (knife is null || !knife.IsValid || CountWeapon(pawn, "weapon_knife") == 0)
                    throw new InvalidOperationException("CS2 did not place weapon_knife in the player's inventory.");
            }

            Logger.LogInformation("GRENADE_ONLY knife granted/verified for SteamID {SteamId}, round {Round}: all 12 allotted grenades were thrown", player.SteamID, _roundNumber);
        }
        catch (Exception ex)
        {
            Logger.LogError(ex, "GRENADE_ONLY knife grant failed for SteamID {SteamId}, round {Round} after all allotted grenades were thrown", player.SteamID, _roundNumber);
        }
    }

    private static void GiveGrenades(CCSPlayerController player, string classname, int count)
    {
        for (var i = 0; i < count; i++)
        {
            var weapon = player.GiveNamedItem<CBasePlayerWeapon>(classname);
            if (weapon is null || !weapon.IsValid)
                throw new InvalidOperationException($"CS2 failed to create {classname} ({i + 1}/{count}).");
        }
    }

    private static Dictionary<GrenadeKind, int> CountGrenades(CCSPlayerPawn pawn)
    {
        var counts = Enum.GetValues<GrenadeKind>().ToDictionary(kind => kind, _ => 0);
        var services = pawn.WeaponServices?.As<CCSPlayer_WeaponServices>();
        if (services is null) return counts;
        foreach (var handle in services.MyWeapons)
        {
            var weapon = handle.Value;
            if (weapon is null || !weapon.IsValid) continue;
            var kind = GetGrenadeKind(weapon.GetWeaponName() ?? string.Empty);
            if (kind is not null) counts[kind.Value]++;
        }
        return counts;
    }

    private static int CountWeapon(CCSPlayerPawn pawn, string classname)
    {
        var services = pawn.WeaponServices?.As<CCSPlayer_WeaponServices>();
        if (services is null) return 0;
        return services.MyWeapons.Count(handle =>
        {
            var weapon = handle.Value;
            return weapon is not null && weapon.IsValid
                && NormalizeWeaponName(weapon.GetWeaponName() ?? string.Empty) == NormalizeWeaponName(classname);
        });
    }

    private static GrenadeKind? GetGrenadeKind(string weapon)
    {
        return NormalizeWeaponName(weapon) switch
        {
            "weapon_hegrenade" => GrenadeKind.He,
            "weapon_flashbang" => GrenadeKind.Flash,
            "weapon_smokegrenade" => GrenadeKind.Smoke,
            "weapon_molotov" or "weapon_incgrenade" => GrenadeKind.Incendiary,
            _ => null
        };
    }

    private static string NormalizeWeaponName(string weapon)
    {
        var normalized = weapon.Trim().ToLowerInvariant();
        return normalized.StartsWith("weapon_", StringComparison.Ordinal) ? normalized : $"weapon_{normalized}";
    }

    private bool EnsureGrenadeLimits(CCSPlayerController player)
    {
        var total = ReadConVarInt("ammo_grenade_limit_total");
        var defaultLimit = ReadConVarInt("ammo_grenade_limit_default");
        var flashLimit = ReadConVarInt("ammo_grenade_limit_flashbang");
        if (total == GrenadeRoundState.GrenadesPerType * 4 && defaultLimit == GrenadeRoundState.GrenadesPerType && flashLimit == GrenadeRoundState.GrenadesPerType) return true;

        Logger.LogError(
            "GRENADE_ONLY cannot issue loadout for SteamID {SteamId}, round {Round}: grenade cvars are not confirmed (total={Total}, default={Default}, flashbang={Flashbang}); expected 12/3/3",
            player.SteamID, _roundNumber, total, defaultLimit, flashLimit);
        return false;
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
        try { return cvar.GetPrimitiveValue<int>(); }
        catch { return null; }
    }

    private static void ConfigureGrenadeLimits()
    {
        Server.ExecuteCommand("ammo_grenade_limit_total 12");
        Server.ExecuteCommand("ammo_grenade_limit_default 3");
        Server.ExecuteCommand("ammo_grenade_limit_flashbang 3");
    }

    private void RestoreGrenadeLimits()
    {
        if (_previousGrenadeTotal.HasValue) Server.ExecuteCommand($"ammo_grenade_limit_total {_previousGrenadeTotal.Value}");
        if (_previousGrenadeDefault.HasValue) Server.ExecuteCommand($"ammo_grenade_limit_default {_previousGrenadeDefault.Value}");
        if (_previousFlashbangLimit.HasValue) Server.ExecuteCommand($"ammo_grenade_limit_flashbang {_previousFlashbangLimit.Value}");
        _previousGrenadeTotal = null;
        _previousGrenadeDefault = null;
        _previousFlashbangLimit = null;
    }

    private void CaptureAndBlockPickup(CCSPlayerController player, CCSPlayerPawn pawn, long lifeId)
    {
        var services = pawn.WeaponServices!.As<CCSPlayer_WeaponServices>();
        if (!_pickupSnapshots.TryGetValue(player.SteamID, out var snapshot) || snapshot.LifeId != lifeId)
            _pickupSnapshots[player.SteamID] = new PickupSnapshot(lifeId, services.PreventWeaponPickup);
        services.PreventWeaponPickup = true;
    }

    private void RestoreAllPickupStates()
    {
        foreach (var player in Utilities.GetPlayers())
        {
            if (player is null || !player.IsValid) continue;
            if (!_pickupSnapshots.TryGetValue(player.SteamID, out var snapshot)) continue;
            try
            {
                var pawn = player.PlayerPawn.Value;
                if (pawn is not null && pawn.IsValid && GetLifeId(player) == snapshot.LifeId)
                    pawn.WeaponServices!.As<CCSPlayer_WeaponServices>().PreventWeaponPickup = snapshot.WasPrevented;
            }
            catch (Exception ex)
            {
                Logger.LogWarning(ex, "Could not restore weapon pickup state for SteamID {SteamId}", player.SteamID);
            }
        }
        _pickupSnapshots.Clear();
    }

    private static long GetLifeId(CCSPlayerController player) => player.PawnLifetimeStart;

    private static bool IsLivePlayer(CCSPlayerController? player) =>
        player is not null && player.IsValid && !player.IsBot && player.PawnIsAlive
        && player.PlayerPawn.Value is { IsValid: true };

    private static bool TryGetLivePawn(CCSPlayerController player, out CCSPlayerPawn pawn)
    {
        pawn = player.PlayerPawn.Value!;
        return player.PawnIsAlive && pawn is { IsValid: true } && pawn.WeaponServices is not null;
    }

    private void QueueThrowInventoryCheck(CCSPlayerController player, GrenadeKind kind, long roundId, int attempt = 0)
    {
        var key = (roundId, player.SteamID, kind);
        if (attempt == 0)
        {
            if (_pendingThrowChecks.TryGetValue(key, out var pendingEvents))
            {
                if (pendingEvents < GrenadeRoundState.GrenadesPerType)
                    _pendingThrowChecks[key] = pendingEvents + 1;
                return;
            }
            _pendingThrowChecks[key] = 1;
        }

        // CSS schedules this on its game thread after the engine has removed the thrown item.
        Server.NextFrame(() =>
        {
            if (!_enabled || !_roundStarted || roundId != _roundNumber
                || !_playerRoundStates.TryGetValue(player.SteamID, out var state) || state.RoundId != roundId)
            {
                _pendingThrowChecks.Remove(key);
                return;
            }

            if (!player.IsValid || !TryGetValidPawn(player, out var pawn))
            {
                _pendingThrowChecks.Remove(key);
                Logger.LogWarning("GRENADE_ONLY could not verify post-throw inventory for SteamID {SteamId}, round {Round}, type {Type}", player.SteamID, roundId, kind);
                return;
            }

            var actualCount = CountGrenades(pawn)[kind];
            var matchingEvents = _pendingThrowChecks.GetValueOrDefault(key);
            if (state.TryRecordThrow(roundId, kind, actualCount, matchingEvents, out var consumed))
            {
                Logger.LogInformation(
                    "GRENADE_ONLY throw verified: SteamID {SteamId}, round {Round}, type {Type}, consumed {Consumed}, remaining HE={He} flash={Flash} smoke={Smoke} incendiary={Incendiary}",
                    player.SteamID, roundId, kind, consumed, state.Remaining(GrenadeKind.He), state.Remaining(GrenadeKind.Flash),
                    state.Remaining(GrenadeKind.Smoke), state.Remaining(GrenadeKind.Incendiary));
                _pendingThrowChecks.Remove(key);
                if (state.RemainingTotal == 0) GiveKnifeIfGrenadesSpent(player, state, GetLifeId(player), pawn);
                return;
            }

            if (attempt < 2 && state.RoundId == _roundNumber)
            {
                QueueThrowInventoryCheck(player, kind, roundId, attempt + 1);
                return;
            }

            _pendingThrowChecks.Remove(key);
            Logger.LogWarning(
                "GRENADE_ONLY throw was not deducted: SteamID {SteamId}, round {Round}, type {Type}, actual inventory={Inventory}; entitlement unchanged",
                player.SteamID, roundId, kind, actualCount);
        });
    }

    private static bool TryGetValidPawn(CCSPlayerController player, out CCSPlayerPawn pawn)
    {
        pawn = player.PlayerPawn.Value!;
        return pawn is { IsValid: true } && pawn.WeaponServices is not null;
    }

    private EngineRoundIdentity? GetEngineRoundIdentity()
    {
        try
        {
            var proxy = Utilities.FindAllEntitiesByDesignerName<CCSGameRulesProxy>("cs_gamerules")
                .FirstOrDefault(candidate => candidate is { IsValid: true });
            if (proxy is null) return null;
            var rules = proxy.GameRules;
            if (rules is null) return null;
            return new EngineRoundIdentity(rules.TotalRoundsPlayed, rules.RoundStartRoundNumber, rules.RoundStartCount);
        }
        catch (Exception ex)
        {
            Logger.LogError(ex, "GRENADE_ONLY failed to read the engine round identity");
            return null;
        }
    }
}
