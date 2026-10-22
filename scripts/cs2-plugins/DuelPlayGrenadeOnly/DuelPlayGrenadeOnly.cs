using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes;
using CounterStrikeSharp.API.Core.Attributes.Registration;
using CounterStrikeSharp.API.Modules.Commands;
using CounterStrikeSharp.API.Modules.Cvars;
using CounterStrikeSharp.API.Modules.Extensions;
using CounterStrikeSharp.API.Modules.Memory;
using CounterStrikeSharp.API.Modules.Timers;
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
    // One main re-select plus at most one delayed retry. The old three immediate retries
    // re-sent an identical `use weapon_*` within ~30 ms because the server ActiveWeapon
    // does not change until the client's command is processed.
    private const int MaxDeployAttempts = 2;
    private const float DeployRetryDelaySeconds = 0.25f;
    private const int StrayKnifeRefreshCooldownMilliseconds = 1000;

    // Temporary GRENADE_ONLY round-transition diagnostics. All diagnostic paths also
    // require _enabled so other game modes never emit this trace.
    private static readonly bool Diagnostics = true;
    private const float DiagnosticsIntervalSeconds = 5.0f;
    private const int DiagnosticRateLimitMilliseconds = 100;
    private const int MaxDiagnosticLinesPerPlayerRound = 180;

    // The engine clears m_hSwitchToWeaponAfterThrow when a grenade is deployed, so the
    // post-throw switch target must be kept armed while the player still holds grenades.
    private const float ArmSwitchIntervalSeconds = 0.1f;

    // Workshop maps execute their own config after the manager's launch rules and can
    // re-open the shop or refill money during Game_Commencing. Reassert the closed
    // economy from the plugin as well, not only through the generated server cfg.
    private static readonly (string Name, int Value)[] ClosedEconomyCvars =
    {
        ("mp_maxmoney", 0),
        ("mp_startmoney", 0),
        ("mp_afterroundmoney", 0),
        ("mp_buytime", 0),
        ("mp_buy_anywhere", 0),
        ("mp_buy_during_immunity", 0),
        ("mp_buy_allow_guns", 0),
        ("mp_buy_allow_grenades", 0),
        ("mp_free_armor", 0),
    };

    public override string ModuleName => "DuelPlay Grenade Only";
    public override string ModuleVersion => "1.2.11";
    public override string ModuleAuthor => "DuelPlay";
    public override string ModuleDescription => "Grants a verified round-scoped grenade set (reset per round), then one knife per life.";

    private bool _enabled;
    private bool _roundStarted;
    private long _roundNumber;
    private DateTime _roundStartedUtc;
    private EngineRoundIdentity? _engineRoundIdentity;
    private EngineRoundIdentity? _diagnosticRoundIdentity;
    private readonly Dictionary<ulong, GrenadeRoundState> _playerRoundStates = new();
    private readonly HashSet<(long RoundId, ulong SteamId, GrenadeKind Kind)> _pendingThrowChecks = new();
    private readonly Dictionary<ulong, PickupSnapshot> _pickupSnapshots = new();
    private readonly Dictionary<ulong, long> _lastLifeBySteamId = new();
    private readonly Dictionary<ulong, long> _lastDiagLifeBySteamId = new();
    private readonly Dictionary<string, DateTime> _diagnosticLastWriteUtc = new(StringComparer.Ordinal);
    private readonly Dictionary<(long RoundId, ulong SteamId), int> _diagnosticLinesByPlayerRound = new();
    private readonly HashSet<(long RoundId, ulong SteamId)> _diagnosticLimitNotified = new();
    private readonly Dictionary<(long RoundId, ulong SteamId, long LifeId), DateTime> _lastStrayKnifeRefreshUtc = new();
    private int? _previousGrenadeTotal;
    private int? _previousGrenadeDefault;
    private int? _previousFlashbangLimit;
    private bool? _previousRespawnT;
    private bool? _previousRespawnCt;
    private bool? _previousRespawnWaves;

    public override void Load(bool hotReload)
    {
        RegisterEventHandler<EventPlayerSpawned>((@event, info) =>
        {
            // A mid-round respawn (mp_respawn_on_death) can fire before the engine has
            // produced a live pawn. Nothing else re-applies the kit during the round, so a
            // respawn that landed between the manager's scheduled re-applies kept the old
            // life's kit (only the engine's default knife). Retry for the new life instead.
            if (_enabled)
            {
                EnforceClosedEconomy(@event.Userid);
                LogPlayerLifecycle("spawn-event", @event.Userid, null);
                EnsureSpawnLoadout(@event.Userid, 0);
            }
            return HookResult.Continue;
        });

        RegisterEventHandler<EventRoundStart>((@event, info) =>
        {
            var engineRoundIdentity = GetEngineRoundIdentity();
            _diagnosticRoundIdentity = engineRoundIdentity;
            if (engineRoundIdentity is not null)
            {
                if (_engineRoundIdentity == engineRoundIdentity)
                {
                    LogRoundDiagnostic("duplicate-round-start", "engine identity already observed");
                    LogRoundDiagnosticSnapshots("duplicate-round-start", "engine identity already observed");
                    return HookResult.Continue;
                }
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
            _roundStartedUtc = DateTime.UtcNow;
            _diagnosticLastWriteUtc.Clear();
            _diagnosticLinesByPlayerRound.Clear();
            _diagnosticLimitNotified.Clear();
            _lastStrayKnifeRefreshUtc.Clear();
            _pendingThrowChecks.Clear();
            foreach (var state in _playerRoundStates.Values) state.ResetForNewRound(_roundNumber);
            Logger.LogInformation("GRENADE_ONLY round {Round} started; player grenade entitlements reset", _roundNumber);
            LogRoundDiagnostic("round-start-reset", "engine EventRoundStart accepted; per-player states reset");
            LogRoundDiagnosticSnapshots("round-start-reset", "player round states reset before loadout");

            if (_enabled)
            {
                EnforceClosedEconomyForAll();
                foreach (var player in Utilities.GetPlayers().Where(IsLivePlayer)) ApplyLoadout(player);
            }

            LogRoundDiagnostic("round-start-after-loadout", "round-start loadout pass completed");
            LogRoundDiagnosticSnapshots("round-start-after-loadout", "round-start loadout pass completed");

            ScheduleMovementProbes(_roundNumber);

            return HookResult.Continue;
        });

        RegisterEventHandler<EventRoundFreezeEnd>((@event, info) =>
        {
            if (!_enabled) return HookResult.Continue;
            // Map/runtime commands can still run between round start and freeze end.
            EnforceClosedEconomyForAll();
            if (!Diagnostics || !_roundStarted) return HookResult.Continue;
            LogMovementProbe(_roundNumber, "round-freeze-end", DateTime.UtcNow);
            return HookResult.Continue;
        });

        RegisterEventHandler<EventRoundEnd>((@event, info) =>
        {
            var engineRoundIdentity = GetEngineRoundIdentity();
            if (engineRoundIdentity is not null && engineRoundIdentity != _engineRoundIdentity) return HookResult.Continue;
            _diagnosticRoundIdentity = engineRoundIdentity;
            LogRoundDiagnostic("round-end", "CS2 EventRoundEnd received");
            LogRoundDiagnosticSnapshots("round-end", "CS2 EventRoundEnd received");
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
            LogPlayerLifecycle("death-before-finalize", player, null);
            FinalizePendingThrows(player);
            LogPlayerLifecycle("death-after-finalize", player, null);
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
            _lastDiagLifeBySteamId.Remove(player.SteamID);
            foreach (var key in _lastStrayKnifeRefreshUtc.Keys.Where(key => key.SteamId == player.SteamID).ToArray())
                _lastStrayKnifeRefreshUtc.Remove(key);
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
            _diagnosticRoundIdentity = null;
            _pendingThrowChecks.Clear();
            _playerRoundStates.Clear();
            _lastLifeBySteamId.Clear();
            _lastDiagLifeBySteamId.Clear();
            _diagnosticLastWriteUtc.Clear();
            _diagnosticLinesByPlayerRound.Clear();
            _diagnosticLimitNotified.Clear();
            _lastStrayKnifeRefreshUtc.Clear();
            Logger.LogInformation("GRENADE_ONLY map state reset");
        });

        AddTimer(DiagnosticsIntervalSeconds, () =>
        {
            if (!Diagnostics || !_enabled || !_roundStarted) return;
            foreach (var player in Utilities.GetPlayers().Where(IsLivePlayer))
            {
                if (!_playerRoundStates.TryGetValue(player.SteamID, out var state) || state.RoundId != _roundNumber) continue;
                var lifeId = GetLifeId(player);
                // Detect a new pawn lifetime even if EventPlayerSpawned was not delivered.
                if (!_lastDiagLifeBySteamId.TryGetValue(player.SteamID, out var knownLife) || knownLife != lifeId)
                {
                    _lastDiagLifeBySteamId[player.SteamID] = lifeId;
                    LogPlayerLifecycle("life-change", player, state);
                }
                // The defect only appears once a single grenade type is left; probe that
                // state so the log shows whether the active weapon is still deployable.
                if (state.RemainingTotal == 0 || state.RemainingKinds().Count != 1) continue;
                if (!TryGetValidPawn(player, out var pawn)) continue;
                LogGrenadeDiagnostics(player, pawn, state, "probe", GetLifeId(player), null);
            }
        }, TimerFlags.REPEAT);

        // Keep a real post-throw switch target armed on every remaining grenade. A grenade
        // granted by GiveNamedItem never receives the switch the engine sets on a normally
        // acquired stack, so after a throw that leaves a single kind with ammo the engine has
        // nothing to switch to, the client stops sending throw commands and the remaining
        // grenades stay visible but unthrowable. The engine clears the field on deploy, so it
        // is re-armed on a short interval rather than once per throw.
        AddTimer(ArmSwitchIntervalSeconds, () =>
        {
            if (!_enabled || !_roundStarted) return;
            EnforceClosedEconomyForAll();
            foreach (var player in Utilities.GetPlayers().Where(IsLivePlayer))
            {
                if (!_playerRoundStates.TryGetValue(player.SteamID, out var state) || state.RoundId != _roundNumber) continue;
                var lifeId = GetLifeId(player);

                // Once the round entitlement is spent, the arm timer is the only path that
                // notices a new pawn lifetime in the same round. EventPlayerSpawned can be
                // missed or can fire before the pawn exists, and a new life starts with the
                // engine's default knife only. ApplyLoadout no longer grants a knife,
                // which never re-issues grenades at zero and refuses a second knife for the
                // same life through HasKnifeBeenGranted/TryBeginKnife.
                if (state.RemainingTotal == 0)
                {
                    // No knife is ever granted; an exhausted life simply has no grenades left.
                    continue;
                }

                if (!TryGetValidPawn(player, out var pawn)) continue;

                // A respawn hands the new life the engine's default knife before this timer
                // fires. Never strip it until the remaining grenades have actually been
                // granted: removing the only weapon left the player with nothing, and
                // deleting the knife during the respawn PVS transition crashed CS2 with
                // "WriteEnterPVS: GetEntServerClass failed". Apply the kit first, then strip.
                if (!state.IsLoadoutCommitted(lifeId))
                {
                    ApplyLoadout(player);
                    if (!state.IsLoadoutCommitted(lifeId)) continue;
                }

                // CS2's spawn equip re-adds a melee even with mp_*_default_melee 0, so a
                // stray knife can appear a few seconds into a grenade round and be selected
                // while grenades are still unthrown. Remove it and put the player back on a
                // remaining grenade. Use the engine's existing whole-loadout removal path
                // rather than deleting an individual entity during a pawn PVS transition.
                ArmPostThrowSwitch(player, pawn);
                if (CountWeapon(pawn, "weapon_knife") > 0)
                {
                    RefreshRemainingLoadoutAfterStrayKnife(player, state, pawn, _roundNumber, lifeId);
                    continue;
                }
            }
        }, TimerFlags.REPEAT);

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
        _lastDiagLifeBySteamId.Clear();
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
            EnforceClosedEconomyForAll();
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
        if (!_enabled || !_roundStarted || !IsLivePlayer(player) || !TryGetLivePawn(player!, out var pawn))
        {
            LogPawnDiagnostic("apply-loadout-skipped", player, "inactive mode, round, player, or pawn");
            return;
        }
        if (!EnsureGrenadeLimits(player!))
        {
            LogPawnDiagnostic("apply-loadout-skipped", player, "grenade limits not confirmed");
            return;
        }

        var lifeId = GetLifeId(player!);
        LogPawnDiagnostic("apply-loadout-before", player, "entry", sourceRoundId: _roundNumber, sourceLifeId: lifeId);

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
            // GRENADE_ONLY has no knife in any life cycle. Do not grant or select one.
            LogPawnDiagnostic("apply-loadout-exhausted", player, "grenade entitlement exhausted; no knife granted", sourceRoundId: _roundNumber, sourceLifeId: lifeId);
            return;
        }

        if (!state.TryBeginLoadout(_roundNumber, lifeId, player.TeamNum))
        {
            var reason = state.IsLoadoutPending(_roundNumber, lifeId) ? "loadout reservation already pending" : "loadout already committed for team";
            LogPawnDiagnostic("apply-loadout-skipped", player, reason, sourceRoundId: _roundNumber, sourceLifeId: lifeId);
            return;
        }

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
                LogPawnDiagnostic("apply-loadout-attempt-before", player, "grant attempt", attempt, _roundNumber, lifeId);
                // Reached only for a live pawn during an active round, with required
                // game limits verified. Failed item creation is logged and never becomes a knife.
                // Pickup may still be blocked from a previous life's knife grant; clear it or
                // CS2 creates the entities without attaching them (inventory stays at zero).
                AllowPickup(pawn);
                player.RemoveWeapons();
                var incendiary = GrenadeCatalog.Classname(GrenadeKind.Incendiary, player.TeamNum == (byte)CsTeam.Terrorist);
                GiveGrenades(player, "weapon_hegrenade", expected[GrenadeKind.He]);
                GiveGrenades(player, "weapon_flashbang", expected[GrenadeKind.Flash]);
                GiveGrenades(player, "weapon_smokegrenade", expected[GrenadeKind.Smoke]);
                GiveGrenades(player, incendiary, expected[GrenadeKind.Incendiary]);

                var actual = CountGrenades(pawn);

                if (Enum.GetValues<GrenadeKind>().All(kind => actual[kind] == expected[kind]))
                {
                    state.CompleteLoadout(_roundNumber, lifeId, expected);
                    ArmPostThrowSwitch(player, pawn);
                    // The client may still be entering the new life's PVS. Stripping the
                    // engine's melee immediately after a respawn grant raced that transition
                    // and crashed CS2 in WriteEnterPVS. The armed timer strips it on its next
                    // tick, once the loadout is committed, and re-selects a grenade.
                    // Pickup stays allowed for the whole grenade phase. CS2 re-selects
                    // the weapon that is thrown from and refuses to attach/re-equip a
                    // grenade while pickup is blocked; blocking after the grant left the
                    // final remaining grenade unselectable (the client never sent the
                    // throw command). The mode already removes ground weapons and drops
                    // through its cfg, so blocking here is not needed.
                    Logger.LogInformation(
                        "GRENADE_ONLY loadout verified for SteamID {SteamId}, round {Round}: HE={He} flash={Flash} smoke={Smoke} incendiary={Incendiary}",
                        player.SteamID, _roundNumber, actual[GrenadeKind.He], actual[GrenadeKind.Flash], actual[GrenadeKind.Smoke], actual[GrenadeKind.Incendiary]);
                    LogPawnDiagnostic("apply-loadout-after", player, "full inventory verified", attempt, _roundNumber, lifeId);
                    LogGrenadeDiagnostics(player, pawn, state, "loadout", lifeId, null);
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
                LogPawnDiagnostic("apply-loadout-attempt-failed", player, ex.GetType().Name, attempt, _roundNumber, lifeId);
                Logger.LogError(ex, "GRENADE_ONLY loadout attempt {Attempt}/{Max} failed for SteamID {SteamId}, round {Round}",
                    attempt, MaxLoadoutAttempts, player.SteamID, _roundNumber);
            }
        }

        // Never adopt a partial grant as ground truth: leaving the loadout uncommitted
        // keeps the missing grenades on the books so the round can retry and the knife
        // is not granted for grenades CS2 never made throwable.
        state.AbortLoadout(_roundNumber, lifeId);
        LogPawnDiagnostic("apply-loadout-after", player, "all attempts failed; reservation aborted", MaxLoadoutAttempts, _roundNumber, lifeId);
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

    // A mid-round respawn can fire EventPlayerSpawned before the engine has a live pawn (or,
    // on the opening round, before EventRoundStart), and no other handler re-applies the kit
    // during the round. The manager's enforcement command only fires on a schedule, so a
    // respawn that landed between re-applies kept only the engine's default knife. Retrying
    // for the new life makes the respawn loadout deterministic. Re-applies are idempotent
    // (a committed life is skipped) and bounded so a genuinely failed grant is not hammered.
    private const int MaxSpawnLoadoutAttempts = 12;
    private const float SpawnLoadoutRetryIntervalSeconds = 0.25f;

    private void EnsureSpawnLoadout(CCSPlayerController? player, int attempt)
    {
        var sourceRoundId = _roundNumber;
        var sourceLifeId = player is { IsValid: true } ? GetLifeId(player) : -1;
        LogPawnDiagnostic("spawn-loadout-attempt-scheduled", player, "initial EventPlayerSpawned attempt", attempt, sourceRoundId, sourceLifeId);
        EnsureSpawnLoadout(player, attempt, sourceRoundId, sourceLifeId);
    }

    private void EnsureSpawnLoadout(CCSPlayerController? player, int attempt, long sourceRoundId, long sourceLifeId)
    {
        LogPawnDiagnostic("spawn-loadout-attempt-executed", player, "retry callback entered", attempt, sourceRoundId, sourceLifeId);
        if (!_enabled || player is null || !player.IsValid)
        {
            LogPawnDiagnostic("spawn-loadout-attempt-stopped", player, "mode disabled or controller invalid", attempt, sourceRoundId, sourceLifeId);
            return;
        }

        var roundId = _roundNumber;
        ApplyLoadout(player);
        if (!_roundStarted || roundId != _roundNumber)
        {
            LogPawnDiagnostic("spawn-loadout-attempt-stopped", player, "round ended or changed during attempt", attempt, sourceRoundId, sourceLifeId);
            return;
        }

        var lifeId = GetLifeId(player);
        if (IsSpawnKitReady(player, lifeId))
        {
            Logger.LogInformation("GRENADE_ONLY spawn loadout ready for SteamID {SteamId}, round {Round}, life {Life} after {Attempt} retr(ies)", player.SteamID, roundId, lifeId, attempt);
            LogPawnDiagnostic("spawn-loadout-ready", player, "current pawn kit ready", attempt, sourceRoundId, sourceLifeId);
            return;
        }

        if (attempt + 1 >= MaxSpawnLoadoutAttempts)
        {
            Logger.LogError(
                "GRENADE_ONLY respawn loadout not ready for SteamID {SteamId}, round {Round}, life {Life} after {Max} attempts; roundStarted={RoundStarted}, committed={Committed}, remainingTotal={Total}, hasKnife={HasKnife}",
                player.SteamID, roundId, lifeId, MaxSpawnLoadoutAttempts, _roundStarted,
                _playerRoundStates.TryGetValue(player.SteamID, out var state) && state.IsLoadoutCommitted(lifeId),
                _playerRoundStates.TryGetValue(player.SteamID, out var s2) ? s2.RemainingTotal : -1,
                TryGetValidPawn(player, out var p) && CountWeapon(p, "weapon_knife") > 0);
            LogPawnDiagnostic("spawn-loadout-attempt-stopped", player, "retry budget exhausted", attempt, sourceRoundId, sourceLifeId);
            return;
        }

        LogPawnDiagnostic("spawn-loadout-retry-scheduled", player, $"delay={SpawnLoadoutRetryIntervalSeconds:0.###}s", attempt + 1, sourceRoundId, sourceLifeId);
        AddTimer(SpawnLoadoutRetryIntervalSeconds, () => EnsureSpawnLoadout(player, attempt + 1, sourceRoundId, sourceLifeId));
    }

    private bool IsSpawnKitReady(CCSPlayerController player, long lifeId)
    {
        if (!_playerRoundStates.TryGetValue(player.SteamID, out var state) || state.RoundId != _roundNumber) return false;
        if (state.RemainingTotal > 0) return state.IsLoadoutCommitted(lifeId);
        // The grenade phase is over for this life. No knife is granted, so it is ready.
        return true;
    }

    /// <summary>
    /// CS2 can equip a stray melee during a spawn/PVS transition even with its default-melee
    /// cvars disabled. Refresh the committed, exact remaining grenade inventory through the same engine-managed
    /// RemoveWeapons path used by ApplyLoadout, after validating the current round/life/pawn.
    /// Pending throws must settle first so this refresh cannot restore a grenade in flight.
    /// </summary>
    private bool RefreshRemainingLoadoutAfterStrayKnife(
        CCSPlayerController player,
        GrenadeRoundState state,
        CCSPlayerPawn observedPawn,
        long roundId,
        long lifeId)
    {
        if (!TryGetLivePawn(player, out var currentPawn)) return false;
        var pawnIndex = currentPawn.Index;
        var knifePresent = CountWeapon(currentPawn, "weapon_knife") > 0;
        var hasPendingThrows = Enum.GetValues<GrenadeKind>().Any(kind => state.PendingThrows(kind) > 0);
        if (state.RemainingTotal <= 0
            || !GrenadeRoundState.CanRefreshLoadoutAfterStrayKnife(
                roundId, _roundNumber, state.RoundId, lifeId, GetLifeId(player),
                observedPawn.Index, pawnIndex, state.IsLoadoutCommitted(lifeId), hasPendingThrows, knifePresent))
        {
            LogPawnDiagnostic("stray-knife-refresh-skipped", player,
                $"round={roundId}/{_roundNumber}/{state.RoundId}, life={lifeId}/{GetLifeId(player)}, pawn={observedPawn.Index}/{pawnIndex}, committed={state.IsLoadoutCommitted(lifeId)}, pendingThrows={hasPendingThrows}, knife={knifePresent}",
                sourceRoundId: roundId, sourceLifeId: lifeId);
            return false;
        }

        var refreshKey = (roundId, player.SteamID, lifeId);
        var now = DateTime.UtcNow;
        if (_lastStrayKnifeRefreshUtc.TryGetValue(refreshKey, out var lastAttempt)
            && (now - lastAttempt).TotalMilliseconds < StrayKnifeRefreshCooldownMilliseconds) return false;
        _lastStrayKnifeRefreshUtc[refreshKey] = now;

        var expected = Enum.GetValues<GrenadeKind>().ToDictionary(kind => kind, state.Remaining);
        var incendiary = GrenadeCatalog.Classname(GrenadeKind.Incendiary, player.TeamNum == (byte)CsTeam.Terrorist);
        LogPawnDiagnostic("stray-knife-refresh-before", player, $"exact remainder={string.Join(',', expected.Select(pair => $"{pair.Key}={pair.Value}"))}", sourceRoundId: roundId, sourceLifeId: lifeId);

        for (var attempt = 1; attempt <= MaxLoadoutAttempts; attempt++)
        {
            if (!_enabled || !_roundStarted || roundId != _roundNumber || state.RoundId != _roundNumber
                || GetLifeId(player) != lifeId || !TryGetLivePawn(player, out var attemptPawn) || attemptPawn.Index != pawnIndex)
            {
                LogPawnDiagnostic("stray-knife-refresh-stopped", player, "round, life, or pawn changed before engine removal", attempt, roundId, lifeId);
                return false;
            }

            try
            {
                AllowPickup(attemptPawn);
                player.RemoveWeapons();
                GiveGrenades(player, "weapon_hegrenade", expected[GrenadeKind.He]);
                GiveGrenades(player, "weapon_flashbang", expected[GrenadeKind.Flash]);
                GiveGrenades(player, "weapon_smokegrenade", expected[GrenadeKind.Smoke]);
                GiveGrenades(player, incendiary, expected[GrenadeKind.Incendiary]);

                if (!TryGetLivePawn(player, out var verifiedPawn) || verifiedPawn.Index != pawnIndex) return false;
                var actual = CountGrenades(verifiedPawn);
                if (Enum.GetValues<GrenadeKind>().All(kind => actual[kind] == expected[kind])
                    && CountWeapon(verifiedPawn, "weapon_knife") == 0)
                {
                    ArmPostThrowSwitch(player, verifiedPawn);
                    EnsureRemainingGrenadeDeployed(player, state, roundId, lifeId, null, force: true);
                    LogPawnDiagnostic("stray-knife-refresh-after", player, $"exact remainder re-verified on attempt {attempt}", attempt, roundId, lifeId);
                    return true;
                }

                Logger.LogWarning(
                    "GRENADE_ONLY safe stray-knife loadout refresh attempt {Attempt}/{Max} for SteamID {SteamId}, round {Round} was short; expected HE={ExpectedHe} flash={ExpectedFlash} smoke={ExpectedSmoke} incendiary={ExpectedIncendiary}; actual HE={He} flash={Flash} smoke={Smoke} incendiary={Incendiary} knife={Knife}",
                    attempt, MaxLoadoutAttempts, player.SteamID, roundId,
                    expected[GrenadeKind.He], expected[GrenadeKind.Flash], expected[GrenadeKind.Smoke], expected[GrenadeKind.Incendiary],
                    actual[GrenadeKind.He], actual[GrenadeKind.Flash], actual[GrenadeKind.Smoke], actual[GrenadeKind.Incendiary],
                    CountWeapon(verifiedPawn, "weapon_knife"));
            }
            catch (Exception ex)
            {
                Logger.LogError(ex, "GRENADE_ONLY safe stray-knife loadout refresh attempt {Attempt}/{Max} failed for SteamID {SteamId}, round {Round}",
                    attempt, MaxLoadoutAttempts, player.SteamID, roundId);
            }
        }

        LogPawnDiagnostic("stray-knife-refresh-failed", player, "all safe engine-managed refresh attempts were short", MaxLoadoutAttempts, roundId, lifeId);
        return false;
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

    private static void EnforceClosedEconomyForAll()
    {
        EnforceClosedEconomy();
        foreach (var player in Utilities.GetPlayers())
        {
            if (player is null || !player.IsValid || player.IsBot) continue;
            EnforceClosedEconomy(player);
        }
    }

    private static void EnforceClosedEconomy(CCSPlayerController? player = null)
    {
        foreach (var (name, value) in ClosedEconomyCvars)
        {
            if (ReadConVarInt(name) == value) continue;
            Server.ExecuteCommand($"{name} {value}");
        }

        if (player is null || !player.IsValid) return;

        var money = player.InGameMoneyServices;
        if (money is not null && money.Account != 0) money.Account = 0;

        if (TryGetValidPawn(player, out var pawn) && pawn.ArmorValue != 0) pawn.ArmorValue = 0;
    }

    private void CaptureGrenadeLimits()
    {
        _previousGrenadeTotal = ReadConVarInt("ammo_grenade_limit_total");
        _previousGrenadeDefault = ReadConVarInt("ammo_grenade_limit_default");
        _previousFlashbangLimit = ReadConVarInt("ammo_grenade_limit_flashbang");
        _previousRespawnT = ReadConVarBool("mp_respawn_on_death_t");
        _previousRespawnCt = ReadConVarBool("mp_respawn_on_death_ct");
        _previousRespawnWaves = ReadConVarBool("mp_use_respawn_waves");
    }

    private static int? ReadConVarInt(string name)
    {
        var cvar = ConVar.Find(name);
        if (cvar is null) return null;
        try { return cvar.GetPrimitiveValue<int>(); }
        catch { return null; }
    }

    private static bool? ReadConVarBool(string name)
    {
        var cvar = ConVar.Find(name);
        if (cvar is null) return null;
        try { return cvar.GetPrimitiveValue<bool>(); }
        catch
        {
            try { return cvar.GetPrimitiveValue<int>() != 0; }
            catch { return null; }
        }
    }

    private static void ConfigureGrenadeLimits()
    {
        Server.ExecuteCommand("ammo_grenade_limit_total 12");
        Server.ExecuteCommand("ammo_grenade_limit_default 3");
        Server.ExecuteCommand("ammo_grenade_limit_flashbang 3");
        // The map cfg sets these too, but gamemode_competitive*.cfg is exec'd again on map
        // load and can overwrite them. A GRENADE_ONLY death must respawn in the same round:
        // otherwise the round ends before the plugin can re-issue the remaining grenades.
        Server.ExecuteCommand("mp_respawn_on_death_t 1");
        Server.ExecuteCommand("mp_respawn_on_death_ct 1");
        Server.ExecuteCommand("mp_use_respawn_waves 0");
    }

    private void RestoreGrenadeLimits()
    {
        if (_previousGrenadeTotal.HasValue) Server.ExecuteCommand($"ammo_grenade_limit_total {_previousGrenadeTotal.Value}");
        if (_previousGrenadeDefault.HasValue) Server.ExecuteCommand($"ammo_grenade_limit_default {_previousGrenadeDefault.Value}");
        if (_previousFlashbangLimit.HasValue) Server.ExecuteCommand($"ammo_grenade_limit_flashbang {_previousFlashbangLimit.Value}");
        RestoreForcedRespawnCvar("mp_respawn_on_death_t", _previousRespawnT, forced: true);
        RestoreForcedRespawnCvar("mp_respawn_on_death_ct", _previousRespawnCt, forced: true);
        RestoreForcedRespawnCvar("mp_use_respawn_waves", _previousRespawnWaves, forced: false);
        _previousGrenadeTotal = null;
        _previousGrenadeDefault = null;
        _previousFlashbangLimit = null;
        _previousRespawnT = null;
        _previousRespawnCt = null;
        _previousRespawnWaves = null;
    }

    /// <summary>
    /// Restores a respawn cvar only while it still holds the value this plugin forced. A
    /// newer mode policy may already have written the correct value before the plugin is
    /// disabled; overwriting it would turn respawn back on for a normal duel.
    /// </summary>
    private static void RestoreForcedRespawnCvar(string name, bool? previous, bool forced)
    {
        if (!previous.HasValue) return;
        if (ReadConVarBool(name) != forced) return;
        Server.ExecuteCommand($"{name} {(previous.Value ? 1 : 0)}");
    }

    private void CapturePickupState(CCSPlayerController player, CCSPlayerPawn pawn, long lifeId)
    {
        var services = pawn.WeaponServices!.As<CCSPlayer_WeaponServices>();
        if (!_pickupSnapshots.TryGetValue(player.SteamID, out var snapshot))
        {
            _pickupSnapshots[player.SteamID] = new PickupSnapshot(lifeId, services.PreventWeaponPickup);
            return;
        }

        // Weapon services survive respawns and round transitions. Pickup is blocked only after
        // the knife is granted, so a new life may carry our own true value forward; it must not
        // be mistaken for the original pre-plugin value and left blocked after disable/unload.
        if (snapshot.LifeId != lifeId)
            _pickupSnapshots[player.SteamID] = new PickupSnapshot(lifeId, snapshot.WasPrevented);
    }

    /// <summary>
    /// CS2 will create the item but refuse to attach or re-select it while pickup is blocked,
    /// so every grant (including a respawn re-issue) must allow pickup. It is re-blocked only
    /// once the grenade phase is over and the knife has been granted.
    /// </summary>
    private static void AllowPickup(CCSPlayerPawn pawn)
    {
        pawn.WeaponServices!.As<CCSPlayer_WeaponServices>().PreventWeaponPickup = false;
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
                if (pawn is not null && pawn.IsValid)
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
            if (state.RemainingTotal == 0)
                LogPawnDiagnostic("last-grenade-exhausted-after-finalize", player, $"death/disconnect finalized {finalized} throw(s)", sourceRoundId: _roundNumber, sourceLifeId: GetLifeId(player));
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
        var lifeId = GetLifeId(player);

        // CSS schedules this on its game thread after the engine has removed the thrown item.
        Server.NextFrame(() =>
        {
            if (!_enabled || !_roundStarted || roundId != _roundNumber
                || !_playerRoundStates.TryGetValue(player.SteamID, out var state) || state.RoundId != roundId)
            {
                _pendingThrowChecks.Remove(key);
                return;
            }

            // Never read the inventory of a newer pawn for a throw from an older life:
            // after a respawn that inventory is the re-issued kit, not this throw's result.
            if (!player.IsValid || GetLifeId(player) != lifeId || !TryGetValidPawn(player, out var pawn))
            {
                // The throw event is authoritative; keep the pending count so death can
                // finalize it instead of refilling the grenade on the next life.
                _pendingThrowChecks.Remove(key);
                Logger.LogWarning("GRENADE_ONLY could not verify post-throw inventory for SteamID {SteamId}, round {Round}, type {Type}; throw remains event-backed", player.SteamID, roundId, kind);
                return;
            }

            // Death/disconnect already reconciled this event-backed throw; do not retry,
            // and never debit it a second time from a later inventory snapshot.
            if (state.PendingThrows(kind) == 0)
            {
                _pendingThrowChecks.Remove(key);
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
                // Keep pickup clear so CS2 can attach/re-select items for the rest of the
                // grenade phase. Once only one grenade type is left the engine's post-throw
                // auto-switch has no valid deploy target, leaves the pawn without an active
                // weapon and the client stops sending sv_throw_* for the final grenade.
                AllowPickup(pawn);
                ArmPostThrowSwitch(player, pawn);
                LogGrenadeDiagnostics(player, pawn, state, "throw", lifeId, kind);
                if (state.RemainingTotal == 0)
                {
                    LogPawnDiagnostic("last-grenade-exhausted", player, $"verified final throw type={kind} consumed={consumed}; no knife granted", sourceRoundId: roundId, sourceLifeId: lifeId);
                    return;
                }
                // Re-select a remaining grenade so the client always has a usable weapon to
                // throw from, exactly like a `use weapon_...` bind.
                EnsureRemainingGrenadeDeployed(player, state, roundId, lifeId, kind);
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

    /// <summary>
    /// Makes sure the pawn still holds a grenade it can actually throw. After a verified
    /// throw the engine switches away; when only one grenade type remains with ammo still
    /// left the engine has no other grenade to auto-switch to, the client stops sending
    /// throw commands while the server still reports the stale thrown grenade as active.
    /// Re-selecting a remaining grenade by its real classname (the documented
    /// <c>use weapon_...</c> bind) resyncs the client. <see
    /// cref="GrenadeRoundState.NeedsRedeployAfterThrow"/> decides when this is required.
    /// At most one command is sent immediately and one after <see
    /// cref="DeployRetryDelaySeconds"/>; the retry is skipped when the engine already
    /// reports the target as active, so one throw cannot produce an identical burst.
    /// </summary>
    private void EnsureRemainingGrenadeDeployed(CCSPlayerController player, GrenadeRoundState? state, long roundId, long lifeId, GrenadeKind? preferred, int attempt = 0, bool force = false)
    {
        if (!_enabled || !_roundStarted || roundId != _roundNumber) return;
        if (!player.IsValid || GetLifeId(player) != lifeId || !TryGetValidPawn(player, out var pawn)) return;

        state ??= _playerRoundStates.GetValueOrDefault(player.SteamID);
        if (state is null || state.RoundId != roundId || state.RemainingTotal == 0) return;

        var target = state.NextDeployTarget(preferred);
        if (target is null) return;

        var classname = GrenadeCatalog.Classname(target.Value, player.TeamNum == (byte)CsTeam.Terrorist);
        var activeName = ActiveWeaponClassname(pawn);
        var deployedKind = activeName is null ? null : GetGrenadeKind(activeName);
        var activeIsTarget = activeName is not null
            && NormalizeWeaponName(activeName) == NormalizeWeaponName(classname);

        if (attempt > 0)
        {
            // A delayed retry is justified only when the engine still does not report the
            // requested grenade as active. Otherwise the client already processed the command.
            if (activeIsTarget)
            {
                Logger.LogInformation(
                    "GRENADE_ONLY re-deploy retry not needed: SteamID {SteamId}, round {Round}, life {Life}, active {Active}",
                    player.SteamID, roundId, lifeId, activeName);
                return;
            }
        }
        else if (!force && !state.NeedsRedeployAfterThrow(deployedKind))
        {
            if (Diagnostics)
                Logger.LogInformation(
                    "GRENADE_ONLY deploy check: SteamID {SteamId}, round {Round}, life {Life}, active {Active} keeps the client in sync; no re-deploy needed",
                    player.SteamID, roundId, lifeId, activeName);
            return;
        }

        try
        {
            player.ExecuteClientCommandFromServer($"use {classname}");
            Logger.LogInformation(
                "GRENADE_ONLY re-deploy issued: SteamID {SteamId}, round {Round}, life {Life}, attempt {Attempt}, target {Target}, command 'use {Class}', active before {Active}, forced {Forced}",
                player.SteamID, roundId, lifeId, attempt, target.Value, classname, activeName ?? "<none>", force);
        }
        catch (Exception ex)
        {
            Logger.LogError(ex, "GRENADE_ONLY re-deploy command failed for SteamID {SteamId}, round {Round}", player.SteamID, roundId);
            return;
        }

        if (attempt >= MaxDeployAttempts - 1) return;
        AddTimer(DeployRetryDelaySeconds, () =>
            EnsureRemainingGrenadeDeployed(player, state, roundId, lifeId, preferred, attempt + 1));
    }

    private static string? ActiveWeaponClassname(CCSPlayerPawn pawn)
    {
        var active = pawn.WeaponServices?.As<CCSPlayer_WeaponServices>().ActiveWeapon.Value;
        return active is { IsValid: true } ? active.GetWeaponName() : null;
    }

    /// <summary>
    /// Arms the engine's post-throw switch on every grenade the player still holds so the
    /// client always has a valid weapon to switch to after a throw. <c>GiveNamedItem</c>
    /// does not set <c>m_hSwitchToWeaponAfterThrow</c> the way a normally acquired grenade
    /// stack does, so once a single kind is left with ammo the engine's post-throw
    /// auto-switch finds no target, the client stops sending throw commands while the
    /// server still reports the stale thrown grenade as active, and the remaining grenades
    /// stay visible but unthrowable. Pointing each grenade's switch (and the saved weapon)
    /// back at itself reproduces the normal stack behavior. The engine clears the field on
    /// deploy, so callers re-arm it on a short interval.
    /// </summary>
    private void ArmPostThrowSwitch(CCSPlayerController player, CCSPlayerPawn pawn)
    {
        var services = pawn.WeaponServices?.As<CCSPlayer_WeaponServices>();
        if (services is null) return;

        foreach (var handle in services.MyWeapons)
        {
            var weapon = handle.Value;
            if (weapon is null || !weapon.IsValid) continue;
            if (GetGrenadeKind(weapon.GetWeaponName() ?? string.Empty) is null) continue;

            try
            {
                var grenade = weapon.As<CBaseCSGrenade>();
                if (grenade.SwitchToWeaponAfterThrow.Raw != handle.Raw)
                {
                    grenade.SwitchToWeaponAfterThrow.Raw = handle.Raw;
                    if (Schema.IsSchemaFieldNetworked("CBaseCSGrenade", "m_hSwitchToWeaponAfterThrow"))
                        Utilities.SetStateChanged(weapon, "CBaseCSGrenade", "m_hSwitchToWeaponAfterThrow");
                }

                if (services.SavedWeapon.Raw != handle.Raw)
                    services.SavedWeapon.Raw = handle.Raw;
            }
            catch (Exception ex)
            {
                Logger.LogWarning(ex, "GRENADE_ONLY could not arm the post-throw switch for SteamID {SteamId}, round {Round}", player.SteamID, _roundNumber);
            }
        }
    }

    private static string? LastWeaponClassname(CCSPlayerPawn pawn)
    {
        var last = pawn.WeaponServices?.As<CCSPlayer_WeaponServices>().LastWeapon.Value;
        return last is { IsValid: true } ? last.GetWeaponName() : null;
    }

    private void WriteDiagnostic(ulong? steamId, string key, Action write, int minIntervalMilliseconds = DiagnosticRateLimitMilliseconds)
    {
        if (!Diagnostics || !_enabled) return;

        var now = DateTime.UtcNow;
        if (_diagnosticLastWriteUtc.TryGetValue(key, out var previous)
            && (now - previous).TotalMilliseconds < minIntervalMilliseconds) return;

        if (steamId is { } id)
        {
            var bucket = (_roundNumber, id);
            var count = _diagnosticLinesByPlayerRound.GetValueOrDefault(bucket);
            if (count >= MaxDiagnosticLinesPerPlayerRound)
            {
                if (_diagnosticLimitNotified.Add(bucket))
                {
                    try { Logger.LogWarning("GRENADE_ONLY diagnostic log cap reached for SteamID {SteamId}, round {Round}; suppressing further diagnostic lines", id, _roundNumber); }
                    catch { }
                }
                return;
            }
            _diagnosticLinesByPlayerRound[bucket] = count + 1;
        }

        _diagnosticLastWriteUtc[key] = now;
        try { write(); }
        catch { /* Diagnostics must never change gameplay behavior. */ }
    }

    private void LogRoundDiagnostic(string phase, string details)
    {
        var identity = _diagnosticRoundIdentity;
        WriteDiagnostic(null, $"round:{_roundNumber}:{phase}", () => Logger.LogInformation(
            "GRENADE_ONLY round trace [{Phase}]: utc={Utc:O}, engineRoundNumber={EngineRound}, totalRoundsPlayed={TotalRoundsPlayed}, roundStartCount={RoundStartCount}, roundId={RoundId}, roundStarted={RoundStarted}, details={Details}",
            phase, DateTime.UtcNow, identity?.RoundStartNumber ?? -1, identity?.TotalRoundsPlayed ?? -1,
            identity?.RoundStartCount ?? 0, _roundNumber, _roundStarted, details));
    }

    private void LogPawnDiagnostic(
        string phase,
        CCSPlayerController? player,
        string details,
        int attempt = -1,
        long? sourceRoundId = null,
        long? sourceLifeId = null)
    {
        try
        {
            var validPlayer = player is { IsValid: true };
            var steamId = validPlayer ? player!.SteamID : 0UL;
            var currentLifeId = validPlayer ? GetLifeId(player!) : -1;
            var sourceRound = sourceRoundId ?? _roundNumber;
            var sourceLife = sourceLifeId ?? currentLifeId;
            var key = $"{_roundNumber}:{steamId}:{phase}:{attempt}:{sourceRound}:{sourceLife}";

            WriteDiagnostic(steamId == 0 ? null : steamId, key, () =>
            {
                var pawn = validPlayer ? player!.PlayerPawn.Value : null;
                var pawnValid = pawn is { IsValid: true };
                var services = pawnValid ? pawn!.WeaponServices?.As<CCSPlayer_WeaponServices>() : null;
                var identity = _diagnosticRoundIdentity;
                var state = validPlayer ? _playerRoundStates.GetValueOrDefault(player!.SteamID) : null;
                Logger.LogInformation(
                    "GRENADE_ONLY trace [{Phase}]: utc={Utc:O}, engineRoundNumber={EngineRound}, totalRoundsPlayed={TotalRoundsPlayed}, roundStartCount={RoundStartCount}, roundId={RoundId}, sourceRoundId={SourceRoundId}, lifeId={LifeId}, sourceLifeId={SourceLifeId}, pawnIndex={PawnIndex}, alive={Alive}, origin={Origin}, velocity={Velocity}, moveType={MoveType}, flags=0x{Flags:X8}, eflags=0x{EFlags:X8}, frozenFlag={Frozen}, active={Active}, preventPickup={PreventPickup}, disableAutoDeploy={DisableAutoDeploy}, stateTotal={StateTotal}, attempt={Attempt}, details={Details}",
                    phase, DateTime.UtcNow,
                    identity?.RoundStartNumber ?? -1, identity?.TotalRoundsPlayed ?? -1, identity?.RoundStartCount ?? 0,
                    _roundNumber, sourceRound, currentLifeId, sourceLife,
                    pawnValid ? pawn!.Index : -1,
                    validPlayer && player!.PawnIsAlive,
                    FormatVector(pawnValid ? pawn!.AbsOrigin : null),
                    FormatVelocity(pawnValid ? pawn!.Velocity : null),
                    pawnValid ? pawn!.MoveType.ToString() : "<none>",
                    pawnValid ? pawn!.Flags : 0u,
                    pawnValid ? pawn!.EFlags : 0,
                    pawnValid && (pawn!.Flags & 0x20u) != 0,
                    pawnValid ? ActiveWeaponClassname(pawn!) ?? "<none>" : "<none>",
                    services?.PreventWeaponPickup, services?.DisableAutoDeploy,
                    state?.RemainingTotal, attempt, details);
            });
        }
        catch { /* Diagnostic field reads must never affect gameplay behavior. */ }
    }

    private void LogRoundDiagnosticSnapshots(string phase, string details)
    {
        if (!Diagnostics || !_enabled) return;
        try
        {
            foreach (var player in Utilities.GetPlayers().Where(candidate => candidate.IsValid))
                LogPawnDiagnostic(phase, player, details);
        }
        catch { /* Diagnostics must never change round processing. */ }
    }

    private static readonly float[] MovementProbeDelaysSeconds = { 0f, 0.5f, 1f, 2f, 5f, 6f, 8f, 10f, 15f };
    private const float LongRoundDiagnosticProbeSeconds = 30f;

    private void ScheduleMovementProbes(long roundId)
    {
        if (!Diagnostics || !_enabled) return;
        foreach (var delay in MovementProbeDelaysSeconds)
        {
            var probeDelay = delay;
            if (probeDelay <= 0f)
            {
                LogMovementProbe(roundId, $"round-start+{probeDelay:0.0}s", DateTime.UtcNow);
                continue;
            }
            AddTimer(probeDelay, () => LogMovementProbe(roundId, $"round-start+{probeDelay:0.0}s", DateTime.UtcNow));
        }
        AddTimer(LongRoundDiagnosticProbeSeconds, () => LogMovementProbe(roundId, $"round-start+{LongRoundDiagnosticProbeSeconds:0.0}s", DateTime.UtcNow));
    }

    /// <summary>
    /// Temporary bounded probes through thirty seconds of a round for the reported
    /// "cannot move after round start" state: actual UTC time, position, velocity,
    /// move type and freeze flags.
    /// </summary>
    private void LogMovementProbe(long roundId, string phase, DateTime atUtc)
    {
        if (!Diagnostics || !_enabled || !_roundStarted || roundId != _roundNumber) return;
        var sinceRoundStart = _roundStartedUtc == default
            ? (double?)null
            : Math.Max(0, (atUtc - _roundStartedUtc).TotalSeconds);
        foreach (var player in Utilities.GetPlayers().Where(candidate => candidate.IsValid))
        {
            LogPawnDiagnostic($"movement:{phase}", player,
                $"sinceRoundStart={sinceRoundStart?.ToString("0.###") ?? "<unknown>"}s, team={player.TeamNum}, probeUtc={atUtc:O}",
                sourceRoundId: roundId, sourceLifeId: GetLifeId(player));
        }
    }

    /// <summary>
    /// Temporary lifecycle diagnostic: death, spawn and pawn-lifetime transitions next to
    /// the plugin's entitlement and the real inventory. This is the evidence needed to see
    /// whether a death produced a new pawn, and why a knife grant was refused.
    /// </summary>
    private void LogPlayerLifecycle(string phase, CCSPlayerController? player, GrenadeRoundState? state)
    {
        if (!Diagnostics || !_enabled || player is null || !player.IsValid) return;
        try
        {
            state ??= _playerRoundStates.GetValueOrDefault(player.SteamID);
            var pawn = player.PlayerPawn.Value;
            var pawnValid = pawn is { IsValid: true };
            var actual = pawnValid ? CountGrenades(pawn!) : null;
            var currentLifeId = GetLifeId(player);
            var committed = state?.IsLoadoutCommitted(currentLifeId) ?? false;
            LogPawnDiagnostic(phase, player,
                $"lifetimeEnd={player.PawnLifetimeEnd}, team={player.TeamNum}, knife={(pawnValid ? CountWeapon(pawn!, "weapon_knife") : 0)}, stateKnown={state is not null}, committed={committed}, inventory=[HE={actual?[GrenadeKind.He]} flash={actual?[GrenadeKind.Flash]} smoke={actual?[GrenadeKind.Smoke]} inc={actual?[GrenadeKind.Incendiary]}]");
        }
        catch { /* Diagnostic inventory reads must never change event handling. */ }
    }

    private static string FormatVector(Vector? value) =>
        value is null ? "<none>" : $"{value.X:0.##},{value.Y:0.##},{value.Z:0.##}";

    private static string FormatVelocity(CNetworkVelocityVector? value) =>
        value is null ? "<none>" : $"{value.X:0.##},{value.Y:0.##},{value.Z:0.##}";

    /// <summary>
    /// Temporary diagnostic: dumps the plugin's entitlement next to the real CS2 weapon
    /// inventory so the HUD-vs-inventory question can be answered from the live logs.
    /// </summary>
    private void LogGrenadeDiagnostics(CCSPlayerController player, CCSPlayerPawn pawn, GrenadeRoundState? state, string phase, long lifeId, GrenadeKind? kind)
    {
        if (!Diagnostics || !_enabled) return;
        WriteDiagnostic(player.SteamID,
            $"{_roundNumber}:{player.SteamID}:grenade:{phase}:{lifeId}:{kind}", () =>
        {
            try
            {
                var services = pawn.WeaponServices?.As<CCSPlayer_WeaponServices>();
                var weapons = services is null
                    ? "<no weapon services>"
                    : string.Join(",", services.MyWeapons.Select(handle =>
                    {
                        var weapon = handle.Value;
                        return weapon is { IsValid: true } ? weapon.GetWeaponName() ?? "?" : "invalid";
                    }));
                var actual = CountGrenades(pawn);
                Logger.LogInformation(
                    "GRENADE_ONLY diag [{Phase}]: SteamID {SteamId}, round {Round}, life {Life}, event {Kind}, state [HE={SHe} flash={SFlash} smoke={SSmoke} inc={SInc} total={STotal} kinds={Kinds}], inventory [HE={AHe} flash={AFlash} smoke={ASmoke} inc={AInc}], weapons=[{Weapons}], active={Active}, last={Last}, preventPickup={Pickup}, disableAutoDeploy={AutoDeploy}",
                    phase, player.SteamID, _roundNumber, lifeId, kind?.ToString() ?? "-",
                    state?.Remaining(GrenadeKind.He), state?.Remaining(GrenadeKind.Flash),
                    state?.Remaining(GrenadeKind.Smoke), state?.Remaining(GrenadeKind.Incendiary),
                    state?.RemainingTotal, state?.RemainingKinds().Count,
                    actual[GrenadeKind.He], actual[GrenadeKind.Flash], actual[GrenadeKind.Smoke], actual[GrenadeKind.Incendiary],
                    weapons, ActiveWeaponClassname(pawn) ?? "<none>", LastWeaponClassname(pawn) ?? "<none>",
                    services?.PreventWeaponPickup, services?.DisableAutoDeploy);
            }
            catch { /* Diagnostic weapon reads must never change gameplay behavior. */ }
        });
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
