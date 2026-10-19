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
