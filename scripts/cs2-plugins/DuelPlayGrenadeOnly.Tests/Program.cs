using DuelPlayGrenadeOnly;

static void Check(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
}

static void CheckRemaining(GrenadeRoundState state, int he, int flash, int smoke, int incendiary, string label)
{
    Check(state.Remaining(GrenadeKind.He) == he, $"{label}: HE remaining");
    Check(state.Remaining(GrenadeKind.Flash) == flash, $"{label}: flash remaining");
    Check(state.Remaining(GrenadeKind.Smoke) == smoke, $"{label}: smoke remaining");
    Check(state.Remaining(GrenadeKind.Incendiary) == incendiary, $"{label}: incendiary remaining");
}

static Dictionary<GrenadeKind, int> Inventory(int he, int flash, int smoke, int incendiary) => new()
{
    [GrenadeKind.He] = he,
    [GrenadeKind.Flash] = flash,
    [GrenadeKind.Smoke] = smoke,
    [GrenadeKind.Incendiary] = incendiary,
};

static void Complete(GrenadeRoundState state, long roundId, long lifeId, byte team, int he, int flash, int smoke, int incendiary)
{
    Check(state.TryBeginLoadout(roundId, lifeId, team), $"{lifeId}: begin loadout");
    Check(state.CompleteLoadout(roundId, lifeId, Inventory(he, flash, smoke, incendiary)), $"{lifeId}: commit full loadout");
}

// Loadout commit/abort: only a fully verified grant becomes the round baseline.
var loadout = new GrenadeRoundState(7);
Check(!loadout.AbortLoadout(7, 100), "aborting a non-pending loadout is a no-op");
Check(loadout.TryBeginLoadout(7, 100, 2), "first life/team loadout reservation");
Check(loadout.IsLoadoutPending(7, 100), "reservation is pending until a full grant is confirmed");
Check(!loadout.TryBeginLoadout(7, 100, 2), "a pending or committed loadout cannot be reserved twice");
Check(loadout.AbortLoadout(7, 100), "a short grant aborts the reservation so the round can retry");
Check(loadout.TryBeginLoadout(7, 100, 2), "retry after abort reserves the loadout again");
Check(loadout.CompleteLoadout(7, 100, Inventory(3, 3, 3, 3)), "full verified grant commits the loadout");
Check(!loadout.IsLoadoutPending(7, 100), "a committed loadout is no longer pending");
Check(!loadout.TryBeginLoadout(7, 100, 2), "duplicate spawn cannot reapply a committed loadout");
Check(loadout.TryBeginLoadout(7, 100, 3), "team change may issue the side-appropriate incendiary");
Check(loadout.CompleteLoadout(7, 100, Inventory(3, 3, 3, 3)), "team-change loadout commits independently");
Check(!loadout.TryBeginKnife(7, 100), "knife remains unavailable while grenades remain");
CheckRemaining(loadout, 3, 3, 3, 3, "committed full grant");

// Throw accounting is event-backed and validated against an observed inventory decrease.
Check(!loadout.TryRecordThrow(7, GrenadeKind.He, 2, out _), "a throw cannot be recorded before it is noted");
Check(loadout.NoteThrow(7, GrenadeKind.He), "throw callback is noted");
Check(loadout.TryRecordThrow(7, GrenadeKind.He, 2, out var consumedHe) && consumedHe == 1, "actual HE inventory decrease is recorded");
Check(!loadout.TryRecordThrow(7, GrenadeKind.He, 2, out _), "duplicate throw callback with unchanged inventory is idempotent");
Check(loadout.NoteThrow(7, GrenadeKind.He), "second throw callback is noted");
Check(loadout.TryRecordThrow(7, GrenadeKind.He, 1, out consumedHe) && consumedHe == 1, "second HE decrease is recorded");
Check(loadout.NoteThrow(7, GrenadeKind.He), "third throw callback is noted");
Check(loadout.TryRecordThrow(7, GrenadeKind.He, 0, out consumedHe) && consumedHe == 1, "third HE decrease is recorded");
Check(!loadout.NoteThrow(7, GrenadeKind.He), "HE quota cannot be exceeded");
CheckRemaining(loadout, 0, 3, 3, 3, "after HE quota");

foreach (var kind in new[] { GrenadeKind.Flash, GrenadeKind.Smoke, GrenadeKind.Incendiary })
{
    for (var count = 2; count >= 0; count--)
    {
        Check(loadout.NoteThrow(7, kind), $"note {kind} throw");
        Check(loadout.TryRecordThrow(7, kind, count, out var consumed) && consumed == 1, $"actual {kind} inventory decrease {count}");
    }
}
Check(loadout.RemainingTotal == 0, "knife transition requires all twelve throws confirmed by inventory");
Check(loadout.TryBeginKnife(7, 100), "knife allowed after all twelve grenades are spent");
Check(!loadout.TryBeginKnife(7, 100), "duplicate exhaustion event cannot issue a second knife this life");
Check(loadout.TryBeginKnife(7, 101), "a respawned life can receive its one knife after exhaustion");

// Death reconciliation: an unverified throw callback must still be spent before respawn.
var death = new GrenadeRoundState(8);
Complete(death, 8, 200, 2, 3, 3, 3, 3);
Check(death.NoteThrow(8, GrenadeKind.He), "throw is noted but not yet observable");
Check(death.PendingThrows(GrenadeKind.He) == 1, "throw stays pending until inventory is observed");
Check(death.FinalizePendingThrows(8) == 1, "death finalizes the event-backed throw");
CheckRemaining(death, 2, 3, 3, 3, "death does not refill a thrown grenade");
Check(!death.TryRecordThrow(8, GrenadeKind.He, 2, out _), "a finalized throw cannot be recorded twice");
Complete(death, 8, 201, 2, 2, 3, 3, 3);
CheckRemaining(death, 2, 3, 3, 3, "respawn retains round consumption");

// A short grant is never adopted as ground truth; the state keeps the full entitlement.
var shortGrant = new GrenadeRoundState(9);
Check(shortGrant.TryBeginLoadout(9, 300, 2), "short grant reservation");
Check(!shortGrant.CompleteLoadout(9, 300, Inventory(1, 1, 1, 1)), "a partial grant cannot be committed");
Check(shortGrant.AbortLoadout(9, 300), "short grant aborts");
CheckRemaining(shortGrant, 3, 3, 3, 3, "aborted loadout keeps the full entitlement");
Check(!shortGrant.TryBeginKnife(9, 300), "an uncommitted round cannot reach the knife");

// Reconnect within the same round only re-issues unthrown grenades.
var reconnect = new GrenadeRoundState(5);
Complete(reconnect, 5, 400, 2, 3, 3, 3, 3);
Check(reconnect.NoteThrow(5, GrenadeKind.He), "throw before disconnect is noted");
Check(reconnect.FinalizePendingThrows(5) == 1, "disconnect finalizes the pending throw");
Complete(reconnect, 5, 401, 2, 2, 3, 3, 3);
CheckRemaining(reconnect, 2, 3, 3, 3, "reconnect does not refill the spent grenade");
Check(reconnect.ResetForNewRound(6), "the round after the reconnect resets the entitlement");
CheckRemaining(reconnect, 3, 3, 3, 3, "a new round restores the full set for the reconnected player");
Check(!reconnect.ResetForNewRound(6), "duplicate round-start identity is ignored");

// Stale events from a previous round cannot mutate the current one.
var stale = new GrenadeRoundState(10);
Complete(stale, 10, 500, 2, 3, 3, 3, 3);
Check(!stale.NoteThrow(9, GrenadeKind.He), "stale prior-round throw is rejected");
Check(!stale.TryRecordThrow(9, GrenadeKind.He, 2, out _), "stale prior-round inventory event is rejected");
Check(stale.FinalizePendingThrows(9) == 0, "stale finalize is a no-op");

// A throw is not counted before a committed inventory baseline exists.
var baseline = new GrenadeRoundState(11);
Check(baseline.TryBeginLoadout(11, 600, 2), "baseline reservation");
Check(!baseline.TryRecordThrow(11, GrenadeKind.Incendiary, 2, out _), "throw is not counted before a committed baseline");

Console.WriteLine("DuelPlayGrenadeOnly state scenarios: PASS (commit/abort loadout, inventory-backed throw, duplicate events, per-type quotas, death finalization, short-grant rejection, knife timing, respawn, reconnect, round identity, stale event rejection)");
