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

    private const int MaxLoadoutAttempts = 3;
    private const int MaxThrowVerifyAttempts = 3;

    public override string ModuleName => "DuelPlay Grenade Only";
    public override string ModuleVersion => "1.2.1";
    public override string ModuleAuthor => "DuelPlay";
    public override string ModuleDescription => "Grants a verified round-scoped grenade set (reset per round), then one knife per life.";

    private bool _enabled;
    private bool _roundStarted;
    private long _roundNumber;
    private EngineRoundIdentity? _engineRoundIdentity;
    private readonly Dictionary<ulong, GrenadeRoundState> _playerRoundStates = new();
    private readonly HashSet<(long RoundId, ulong SteamId, GrenadeKind Kind)> _pendingThrowChecks = new();
    private readonly Dictionary<ulong, PickupSnapshot> _pickupSnapshots = new();
    private readonly Dictionary<ulong, long> _lastLifeBySteamId = new();
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
            if (engineRoundIdentity is not null)
            {
                if (_engineRoundIdentity == engineRoundIdentity) return HookResult.Continue;
                _engineRoundIdentity = engineRoundIdentity;
            }
            else
            {
                // The round is already starting even when the game-rules proxy cannot be
                // read yet, which is most likely on the very first round. Blocking here is
                // what left the opening round without grenades, so fall back to the local
                // round counter: the round is still marked active and still resets.
                Logger.LogWarning("GRENADE_ONLY could not read the engine round identity; using the local round counter for round {Round}", _roundNumber + 1);
            }

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
            if (kind is null || !_playerRoundStates.TryGetValue(player.SteamID, out var state)) return HookResult.Continue;
            if (!state.NoteThrow(_roundNumber, kind.Value)) return HookResult.Continue;
            QueueThrowInventoryCheck(player, kind.Value, _roundNumber);
            return HookResult.Continue;
        });

        RegisterEventHandler<EventPlayerDeath>((@event, info) =>
        {
            var player = @event.Userid;
            if (!_enabled || player is null || !player.IsValid) return HookResult.Continue;
            // The throw callback may not have been reconciled with the pawn inventory yet;
            // event-backed throws must still be counted before the respawn re-issues the kit.
            FinalizePendingThrows(player);
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
            if (player is null) return HookResult.Continue;
            FinalizePendingThrows(player);
            _pickupSnapshots.Remove(player.SteamID);
            _lastLifeBySteamId.Remove(player.SteamID);
            // Keep the per-round entitlement so that reconnecting inside the same round
            // only re-issues the grenades that were not thrown yet; the round-start reset
            // still clears it when the next round begins.
            return HookResult.Continue;
        });

        RegisterListener<Listeners.OnMapStart>(_ =>
        {
            RestoreAllPickupStates();
            _roundStarted = false;
            _engineRoundIdentity = null;
            _pendingThrowChecks.Clear();
            _playerRoundStates.Clear();
            _lastLifeBySteamId.Clear();
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
        _lastLifeBySteamId.Clear();
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

        // A new life inherits any throw callback the death event could not reconcile yet.
        if (_lastLifeBySteamId.TryGetValue(player!.SteamID, out var previousLife) && previousLife != lifeId)
            FinalizePendingThrows(player!);
        _lastLifeBySteamId[player!.SteamID] = lifeId;

        if (!_playerRoundStates.TryGetValue(player!.SteamID, out var state))
        {
            state = new GrenadeRoundState(_roundNumber);
            _playerRoundStates[player.SteamID] = state;
        }

        CapturePickupState(player, pawn, lifeId);
        if (state.RemainingTotal == 0)
        {
            GiveKnifeIfGrenadesSpent(player, state, lifeId, pawn);
            return;
        }

        if (!state.TryBeginLoadout(_roundNumber, lifeId, player.TeamNum)) return;

        var expected = new Dictionary<GrenadeKind, int>
        {
            [GrenadeKind.He] = state.Remaining(GrenadeKind.He),
            [GrenadeKind.Flash] = state.Remaining(GrenadeKind.Flash),
            [GrenadeKind.Smoke] = state.Remaining(GrenadeKind.Smoke),
            [GrenadeKind.Incendiary] = state.Remaining(GrenadeKind.Incendiary),
        };

        for (var attempt = 1; attempt <= MaxLoadoutAttempts; attempt++)
        {
            try
            {
                // Reached only for a live pawn during an active round, with required
                // game limits verified. Failed item creation is logged and never becomes a knife.
                player.RemoveWeapons();
                var incendiary = player.TeamNum == (byte)CsTeam.Terrorist ? "weapon_molotov" : "weapon_incgrenade";
                GiveGrenades(player, "weapon_hegrenade", expected[GrenadeKind.He]);
                GiveGrenades(player, "weapon_flashbang", expected[GrenadeKind.Flash]);
                GiveGrenades(player, "weapon_smokegrenade", expected[GrenadeKind.Smoke]);
                GiveGrenades(player, incendiary, expected[GrenadeKind.Incendiary]);

                var actual = CountGrenades(pawn);

                if (Enum.GetValues<GrenadeKind>().All(kind => actual[kind] == expected[kind]))
                {
                    state.CompleteLoadout(_roundNumber, lifeId, expected);
                    BlockPickup(pawn);
                    Logger.LogInformation(
                        "GRENADE_ONLY loadout verified for SteamID {SteamId}, round {Round}: HE={He} flash={Flash} smoke={Smoke} incendiary={Incendiary}",
                        player.SteamID, _roundNumber, actual[GrenadeKind.He], actual[GrenadeKind.Flash], actual[GrenadeKind.Smoke], actual[GrenadeKind.Incendiary]);
                    return;
                }

                Logger.LogWarning(
                    "GRENADE_ONLY loadout attempt {Attempt}/{Max} for SteamID {SteamId}, round {Round}: expected HE={ExpectedHe} flash={ExpectedFlash} smoke={ExpectedSmoke} incendiary={ExpectedIncendiary}; CS2 reports HE={He} flash={Flash} smoke={Smoke} incendiary={Incendiary}",
                    attempt, MaxLoadoutAttempts, player.SteamID, _roundNumber,
                    expected[GrenadeKind.He], expected[GrenadeKind.Flash], expected[GrenadeKind.Smoke], expected[GrenadeKind.Incendiary],
                    actual[GrenadeKind.He], actual[GrenadeKind.Flash], actual[GrenadeKind.Smoke], actual[GrenadeKind.Incendiary]);
            }
            catch (Exception ex)
            {
                Logger.LogError(ex, "GRENADE_ONLY loadout attempt {Attempt}/{Max} failed for SteamID {SteamId}, round {Round}",
                    attempt, MaxLoadoutAttempts, player.SteamID, _roundNumber);
            }
        }

        // Never adopt a partial grant as ground truth: leaving the loadout uncommitted
        // keeps the missing grenades on the books so the round can retry and the knife
        // is not granted for grenades CS2 never made throwable.
        state.AbortLoadout(_roundNumber, lifeId);
        if (TryGetValidPawn(player, out var failedPawn))
        {
            var actual = CountGrenades(failedPawn);
            Logger.LogError(
                "GRENADE_ONLY loadout incomplete for SteamID {SteamId}, round {Round} after {Max} attempts; actual inventory HE={He} flash={Flash} smoke={Smoke} incendiary={Incendiary}; loadout left uncommitted and no knife will be granted",
                player.SteamID, _roundNumber, MaxLoadoutAttempts,
                actual[GrenadeKind.He], actual[GrenadeKind.Flash], actual[GrenadeKind.Smoke], actual[GrenadeKind.Incendiary]);
        }
        else
        {
            Logger.LogError(
                "GRENADE_ONLY loadout incomplete for SteamID {SteamId}, round {Round} after {Max} attempts; inventory unavailable, loadout left uncommitted and no knife will be granted",
                player.SteamID, _roundNumber, MaxLoadoutAttempts);
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
            CapturePickupState(player, knownPawn ?? pawn, lifeId);
            if (CountWeapon(pawn, "weapon_knife") == 0)
            {
                var knife = player.GiveNamedItem<CBasePlayerWeapon>("weapon_knife");
                if (knife is null || !knife.IsValid || CountWeapon(pawn, "weapon_knife") == 0)
                    throw new InvalidOperationException("CS2 did not place weapon_knife in the player's inventory.");
            }

            BlockPickup(knownPawn ?? pawn);
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

    /// <summary>
    /// Counts grenade ammo from <c>CPlayer_WeaponServices.Ammo</c> using each weapon's
    /// <c>PrimaryAmmoType</c> index. Counting weapon entities instead under-reports
    /// stacked grenades (CS2 keeps one entity and tracks the count in the ammo pool).
    /// </summary>
    private static Dictionary<GrenadeKind, int> CountGrenades(CCSPlayerPawn pawn)
    {
        var counts = Enum.GetValues<GrenadeKind>().ToDictionary(kind => kind, _ => 0);
        var services = pawn.WeaponServices?.As<CCSPlayer_WeaponServices>();
        if (services is null) return counts;

        var ammo = services.Ammo;
        var ammoTypesByKind = new Dictionary<GrenadeKind, HashSet<byte>>();

        foreach (var handle in services.MyWeapons)
        {
            var weapon = handle.Value;
            if (weapon is null || !weapon.IsValid) continue;
            var kind = GetGrenadeKind(weapon.GetWeaponName() ?? string.Empty);
            if (kind is null) continue;

            var vdata = weapon.VData;
            if (vdata is null) continue;

            var ammoType = vdata.PrimaryAmmoType;
            if (ammoType >= ammo.Length) continue;

            if (!ammoTypesByKind.TryGetValue(kind.Value, out var ammoTypes))
            {
                ammoTypes = new HashSet<byte>();
                ammoTypesByKind[kind.Value] = ammoTypes;
            }
            ammoTypes.Add(ammoType);
        }

        foreach (var (kind, ammoTypes) in ammoTypesByKind)
        {
            var total = 0;
            foreach (var ammoType in ammoTypes) total += ammo[ammoType];
            counts[kind] = total;
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

    private void CapturePickupState(CCSPlayerController player, CCSPlayerPawn pawn, long lifeId)
    {
        var services = pawn.WeaponServices!.As<CCSPlayer_WeaponServices>();
        if (!_pickupSnapshots.TryGetValue(player.SteamID, out var snapshot) || snapshot.LifeId != lifeId)
            _pickupSnapshots[player.SteamID] = new PickupSnapshot(lifeId, services.PreventWeaponPickup);
    }

    private static void BlockPickup(CCSPlayerPawn pawn)
    {
        pawn.WeaponServices!.As<CCSPlayer_WeaponServices>().PreventWeaponPickup = true;
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

    private void FinalizePendingThrows(CCSPlayerController player)
    {
        if (!_playerRoundStates.TryGetValue(player.SteamID, out var state)) return;

        var finalized = state.FinalizePendingThrows(_roundNumber);
        _pendingThrowChecks.RemoveWhere(key => key.RoundId == _roundNumber && key.SteamId == player.SteamID);
        if (finalized > 0)
        {
            Logger.LogInformation(
                "GRENADE_ONLY finalized {Count} unverified throw(s) for SteamID {SteamId}, round {Round}; remaining HE={He} flash={Flash} smoke={Smoke} incendiary={Incendiary}",
                finalized, player.SteamID, _roundNumber,
                state.Remaining(GrenadeKind.He), state.Remaining(GrenadeKind.Flash),
                state.Remaining(GrenadeKind.Smoke), state.Remaining(GrenadeKind.Incendiary));
        }
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
        if (attempt == 0 && !_pendingThrowChecks.Add(key)) return;

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
                // The throw event is authoritative; keep the pending count so death can
                // finalize it instead of refilling the grenade on the next life.
                _pendingThrowChecks.Remove(key);
                Logger.LogWarning("GRENADE_ONLY could not verify post-throw inventory for SteamID {SteamId}, round {Round}, type {Type}; throw remains event-backed", player.SteamID, roundId, kind);
                return;
            }

            var actualCount = CountGrenades(pawn)[kind];
            if (state.TryRecordThrow(roundId, kind, actualCount, out var consumed))
            {
                Logger.LogInformation(
                    "GRENADE_ONLY throw verified: SteamID {SteamId}, round {Round}, type {Type}, consumed {Consumed}, remaining HE={He} flash={Flash} smoke={Smoke} incendiary={Incendiary}",
                    player.SteamID, roundId, kind, consumed, state.Remaining(GrenadeKind.He), state.Remaining(GrenadeKind.Flash),
                    state.Remaining(GrenadeKind.Smoke), state.Remaining(GrenadeKind.Incendiary));
                _pendingThrowChecks.Remove(key);
                if (state.RemainingTotal == 0) GiveKnifeIfGrenadesSpent(player, state, GetLifeId(player), pawn);
                return;
            }

            if (attempt < MaxThrowVerifyAttempts && state.RoundId == _roundNumber)
            {
                Server.NextFrame(() => QueueThrowInventoryCheck(player, kind, roundId, attempt + 1));
                return;
            }

            _pendingThrowChecks.Remove(key);
            Logger.LogWarning(
                "GRENADE_ONLY post-throw inventory not observed yet: SteamID {SteamId}, round {Round}, type {Type}, inventory={Inventory}; throw remains event-backed",
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
