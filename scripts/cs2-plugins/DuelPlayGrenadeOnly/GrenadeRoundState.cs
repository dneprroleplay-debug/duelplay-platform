namespace DuelPlayGrenadeOnly;

public enum GrenadeKind
{
    He,
    Flash,
    Smoke,
    Incendiary
}

/// <summary>Round-scoped entitlement and event idempotency backed by observed inventory.</summary>
public sealed class GrenadeRoundState(long roundId)
{
    public const int GrenadesPerType = 3;

    private readonly Dictionary<GrenadeKind, int> _thrown = Enum.GetValues<GrenadeKind>()
        .ToDictionary(kind => kind, _ => 0);
    private readonly Dictionary<GrenadeKind, int> _lastVerifiedInventory = new();
    private readonly Dictionary<long, byte> _loadoutTeamByLife = new();
    private readonly HashSet<long> _knifeAttempts = new();

    public long RoundId { get; private set; } = roundId;
    public int Remaining(GrenadeKind kind) => GrenadesPerType - _thrown[kind];
    public int RemainingTotal => Enum.GetValues<GrenadeKind>().Sum(Remaining);

    public bool TryBeginLoadout(long eventRoundId, long lifeId, byte team)
    {
        if (eventRoundId != RoundId || RemainingTotal == 0
            || (_loadoutTeamByLife.TryGetValue(lifeId, out var previousTeam) && previousTeam == team)) return false;
        _loadoutTeamByLife[lifeId] = team;
        return true;
    }

    public bool SetVerifiedInventory(long eventRoundId, GrenadeKind kind, int count)
    {
        if (eventRoundId != RoundId || count < 0 || count > GrenadesPerType) return false;
        _lastVerifiedInventory[kind] = count;
        return true;
    }

    /// <summary>
    /// Counts only an observed inventory decrease. Replayed throw callbacks therefore
    /// cannot consume the same grenade twice.
    /// </summary>
    public bool TryRecordThrow(long eventRoundId, GrenadeKind kind, int observedInventory, int matchingEvents, out int consumed)
    {
        consumed = 0;
        if (eventRoundId != RoundId || observedInventory < 0 || observedInventory > GrenadesPerType
            || matchingEvents <= 0 || !_lastVerifiedInventory.TryGetValue(kind, out var previousInventory)) return false;

        var inventoryDecrease = previousInventory - observedInventory;
        if (inventoryDecrease <= 0) return false;
        // A death or respawn may remove more items than the matching throw events.
        // Count only event-backed decreases, then resynchronize to the observed inventory.
        consumed = Math.Min(inventoryDecrease, matchingEvents);
        if (consumed > Remaining(kind))
        {
            _lastVerifiedInventory[kind] = observedInventory;
            consumed = 0;
            return false;
        }

        _thrown[kind] += consumed;
        _lastVerifiedInventory[kind] = observedInventory;
        return true;
    }

    public bool TryBeginKnife(long eventRoundId, long lifeId)
    {
        return eventRoundId == RoundId && RemainingTotal == 0 && _knifeAttempts.Add(lifeId);
    }

    public bool ResetForNewRound(long newRoundId)
    {
        if (newRoundId == RoundId) return false;
        RoundId = newRoundId;
        foreach (var kind in Enum.GetValues<GrenadeKind>()) _thrown[kind] = 0;
        _lastVerifiedInventory.Clear();
        _loadoutTeamByLife.Clear();
        _knifeAttempts.Clear();
        return true;
    }
}
