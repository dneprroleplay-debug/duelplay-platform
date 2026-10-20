namespace DuelPlayGrenadeOnly;

public enum GrenadeKind
{
    He,
    Flash,
    Smoke,
    Incendiary
}

/// <summary>
/// Round-scoped entitlement and throw accounting.
/// A loadout is committed only after CS2 confirms the full requested inventory.
/// Throw callbacks are event-backed; an unverified throw is still debited when the
/// life ends so a respawn cannot refill a grenade that was already thrown.
/// </summary>
public sealed class GrenadeRoundState(long roundId)
{
    public const int GrenadesPerType = 3;

    private readonly Dictionary<GrenadeKind, int> _thrown = Enum.GetValues<GrenadeKind>()
        .ToDictionary(kind => kind, _ => 0);
    private readonly Dictionary<GrenadeKind, int> _pendingThrows = Enum.GetValues<GrenadeKind>()
        .ToDictionary(kind => kind, _ => 0);
    private readonly Dictionary<GrenadeKind, int> _lastVerifiedInventory = new();
    private readonly Dictionary<long, byte> _committedTeamByLife = new();
    private readonly Dictionary<long, byte> _pendingTeamByLife = new();
    private readonly HashSet<long> _pendingLoadouts = new();
    private readonly HashSet<long> _knifeAttempts = new();

    public long RoundId { get; private set; } = roundId;
    public int Remaining(GrenadeKind kind) => GrenadesPerType - _thrown[kind];
    public int RemainingTotal => Enum.GetValues<GrenadeKind>().Sum(Remaining);
    public int PendingThrows(GrenadeKind kind) => _pendingThrows[kind];

    /// <summary>
    /// Grenade types that still have an unthrown grenade. CS2 keeps one entity per type
    /// and tracks the stack in the ammo pool, so a type with a remaining grenade is the
    /// only thing the engine can still deploy and throw.
    /// </summary>
    public IReadOnlyList<GrenadeKind> RemainingKinds()
    {
        var kinds = new List<GrenadeKind>();
        foreach (var kind in Enum.GetValues<GrenadeKind>())
            if (Remaining(kind) > 0) kinds.Add(kind);
        return kinds;
    }

    /// <summary>
    /// The grenade the player should be holding after a verified throw. The just-thrown
    /// type is preferred so a repeated throw keeps the same stack; otherwise the first
    /// type with an unthrown grenade is chosen. Returns <c>null</c> only when the whole
    /// allowance is spent. With a single remaining type the engine's post-throw
    /// auto-switch deploys nothing, so the caller must re-select this target explicitly.
    /// </summary>
    public GrenadeKind? NextDeployTarget(GrenadeKind? preferred = null)
    {
        if (preferred is { } preferredKind && Remaining(preferredKind) > 0) return preferredKind;
        foreach (var kind in Enum.GetValues<GrenadeKind>())
            if (Remaining(kind) > 0) return kind;
        return null;
    }

    /// <summary>
    /// Decides whether a verified throw must force the client back onto a remaining
    /// grenade with an explicit re-select. With two or more kinds left the engine
    /// auto-switches to another grenade and the client stays in sync. With a single kind
    /// left and ammo still remaining the engine's auto-switch finds no other grenade, the
    /// client stops accepting throw input, while the server keeps reporting the stale
    /// just-thrown grenade as the active weapon. Re-selecting by classname resyncs it.
    /// A throw that is not followed by a usable remaining active grenade also needs it.
    /// </summary>
    public bool NeedsRedeployAfterThrow(GrenadeKind? activeKind)
    {
        if (RemainingTotal == 0) return false;
        if (RemainingKinds().Count == 1) return true;
        return activeKind is null || Remaining(activeKind.Value) <= 0;
    }

    /// <summary>
    /// Reserves a loadout attempt for a life/team. The reservation is not a success:
    /// only <see cref="CompleteLoadout"/> commits it. An aborted or short grant can be
    /// retried instead of permanently marking the life as served.
    /// </summary>
    public bool TryBeginLoadout(long eventRoundId, long lifeId, byte team)
    {
        if (eventRoundId != RoundId || RemainingTotal == 0) return false;
        if (_committedTeamByLife.TryGetValue(lifeId, out var committedTeam) && committedTeam == team) return false;
        if (!_pendingLoadouts.Add(lifeId)) return false;
        _pendingTeamByLife[lifeId] = team;
        return true;
    }

    /// <summary>
    /// Commits a loadout only when CS2 granted the complete expected inventory.
    /// The caller passes the full expected counts; a short grant must be aborted.
    /// </summary>
    public bool CompleteLoadout(long eventRoundId, long lifeId, IReadOnlyDictionary<GrenadeKind, int> verifiedInventory)
    {
        if (eventRoundId != RoundId || verifiedInventory is null) return false;
        if (!_pendingLoadouts.Contains(lifeId)) return false;

        foreach (var kind in Enum.GetValues<GrenadeKind>())
        {
            if (!verifiedInventory.TryGetValue(kind, out var count)
                || count < 0 || count > GrenadesPerType) return false;
            // Only the complete expected inventory commits the loadout. A short grant must
            // be aborted so the missing grenades stay on the books and the knife is not
            // granted for grenades CS2 never made throwable.
            if (count != Remaining(kind)) return false;
        }

        foreach (var kind in Enum.GetValues<GrenadeKind>())
            _lastVerifiedInventory[kind] = verifiedInventory[kind];

        _committedTeamByLife[lifeId] = _pendingTeamByLife[lifeId];
        _pendingLoadouts.Remove(lifeId);
        _pendingTeamByLife.Remove(lifeId);
        return true;
    }

    public bool AbortLoadout(long eventRoundId, long lifeId)
    {
        if (eventRoundId != RoundId) return false;
        _pendingTeamByLife.Remove(lifeId);
        return _pendingLoadouts.Remove(lifeId);
    }

    public bool IsLoadoutPending(long eventRoundId, long lifeId) =>
        eventRoundId == RoundId && _pendingLoadouts.Contains(lifeId);

    /// <summary>
    /// True once a life's complete grenade grant has been verified and committed. Used by
    /// the respawn retry to stop re-applying a loadout that already succeeded, so a
    /// mid-round respawn converges on the exact remainder instead of relying on the
    /// manager's scheduled enforcement command to happen to fire after the respawn.
    /// </summary>
    public bool IsLoadoutCommitted(long lifeId) => _committedTeamByLife.ContainsKey(lifeId);

    /// <summary>Records one actual throw callback. Bounded by the remaining entitlement.</summary>
    public bool NoteThrow(long eventRoundId, GrenadeKind kind)
    {
        if (eventRoundId != RoundId || Remaining(kind) <= _pendingThrows[kind]) return false;
        _pendingThrows[kind]++;
        return true;
    }

    /// <summary>
    /// Counts only an observed inventory decrease. Replayed throw callbacks therefore
    /// cannot consume the same grenade twice. The pending event remains if the
    /// inventory cannot be observed yet, so death can still finalize it.
    /// </summary>
    public bool TryRecordThrow(long eventRoundId, GrenadeKind kind, int observedInventory, out int consumed)
    {
        consumed = 0;
        if (eventRoundId != RoundId || observedInventory < 0 || observedInventory > GrenadesPerType) return false;
        if (!_lastVerifiedInventory.TryGetValue(kind, out var previousInventory)) return false;
        if (_pendingThrows[kind] <= 0) return false;

        var inventoryDecrease = previousInventory - observedInventory;
        if (inventoryDecrease <= 0) return false;

        consumed = Math.Min(inventoryDecrease, _pendingThrows[kind]);
        if (consumed > Remaining(kind)) return false;

        _thrown[kind] += consumed;
        _pendingThrows[kind] -= consumed;
        _lastVerifiedInventory[kind] = observedInventory;
        return true;
    }

    /// <summary>
    /// Event-backed death reconciliation: a throw callback was already observed, so the
    /// grenade is spent even if the pawn died before the deferred inventory check ran.
    /// Returns the total number of throws finalized.
    /// </summary>
    public int FinalizePendingThrows(long eventRoundId)
    {
        if (eventRoundId != RoundId) return 0;

        var finalized = 0;
        foreach (var kind in Enum.GetValues<GrenadeKind>())
        {
            var count = Math.Min(_pendingThrows[kind], Remaining(kind));
            if (count <= 0) continue;
            _thrown[kind] += count;
            _pendingThrows[kind] = 0;
            finalized += count;
        }
        return finalized;
    }

    public bool TryBeginKnife(long eventRoundId, long lifeId)
    {
        return eventRoundId == RoundId && RemainingTotal == 0 && _knifeAttempts.Add(lifeId);
    }

    /// <summary>
    /// True once the knife was requested for this life, whether the grant succeeded or
    /// failed. Diagnostics use it to distinguish a duplicate request from a fresh one.
    /// </summary>
    public bool HasKnifeBeenGranted(long lifeId) => _knifeAttempts.Contains(lifeId);

    public bool ResetForNewRound(long newRoundId)
    {
        if (newRoundId == RoundId) return false;
        RoundId = newRoundId;
        foreach (var kind in Enum.GetValues<GrenadeKind>())
        {
            _thrown[kind] = 0;
            _pendingThrows[kind] = 0;
        }
        _lastVerifiedInventory.Clear();
        _committedTeamByLife.Clear();
        _pendingTeamByLife.Clear();
        _pendingLoadouts.Clear();
        _knifeAttempts.Clear();
        return true;
    }
}

/// <summary>
/// Maps an entitlement type to the real CS2 weapon classname. A grenade can only be
/// thrown when the matching classname is actually deployed, so the re-deploy path and
/// the initial grant must agree on the same names (including the side-specific
/// incendiary).
/// </summary>
public static class GrenadeCatalog
{
    public static string Classname(GrenadeKind kind, bool terrorist) => kind switch
    {
        GrenadeKind.He => "weapon_hegrenade",
        GrenadeKind.Flash => "weapon_flashbang",
        GrenadeKind.Smoke => "weapon_smokegrenade",
        GrenadeKind.Incendiary => terrorist ? "weapon_molotov" : "weapon_incgrenade",
        _ => throw new ArgumentOutOfRangeException(nameof(kind), kind, "Unknown grenade kind")
    };
}
