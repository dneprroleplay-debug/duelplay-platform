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

static void SetInventory(GrenadeRoundState state, long roundId, int he, int flash, int smoke, int incendiary)
{
    Check(state.SetVerifiedInventory(roundId, GrenadeKind.He, he), "verify HE inventory");
    Check(state.SetVerifiedInventory(roundId, GrenadeKind.Flash, flash), "verify flash inventory");
    Check(state.SetVerifiedInventory(roundId, GrenadeKind.Smoke, smoke), "verify smoke inventory");
    Check(state.SetVerifiedInventory(roundId, GrenadeKind.Incendiary, incendiary), "verify incendiary inventory");
}

var state = new GrenadeRoundState(7);
SetInventory(state, 7, 3, 3, 3, 3);
CheckRemaining(state, 3, 3, 3, 3, "initial set");
Check(state.TryBeginLoadout(7, 100, 2), "first life/team loadout");
Check(!state.TryBeginLoadout(7, 100, 2), "duplicate spawn cannot reapply loadout");
Check(state.TryBeginLoadout(7, 100, 3), "team change may issue the side-appropriate incendiary");
Check(state.TryBeginLoadout(7, 100, 2), "switching back to the original side may reapply its incendiary");
Check(!state.TryBeginLoadout(7, 100, 2), "duplicate event for the current team remains idempotent");
Check(!state.TryBeginKnife(7, 100), "knife remains unavailable while grenades remain");

Check(state.TryRecordThrow(7, GrenadeKind.He, 2, 1, out var consumedHe) && consumedHe == 1, "actual HE inventory decrease is recorded");
Check(!state.TryRecordThrow(7, GrenadeKind.He, 2, 1, out _), "duplicate throw callback with unchanged inventory is idempotent");
Check(state.TryRecordThrow(7, GrenadeKind.He, 1, 1, out consumedHe) && consumedHe == 1, "second HE decrease is recorded");
Check(state.TryRecordThrow(7, GrenadeKind.He, 0, 1, out consumedHe) && consumedHe == 1, "third HE decrease is recorded");
Check(!state.TryRecordThrow(7, GrenadeKind.He, 0, 1, out _), "HE cannot exceed its per-round quota");
CheckRemaining(state, 0, 3, 3, 3, "after HE quota");

foreach (var kind in new[] { GrenadeKind.Flash, GrenadeKind.Smoke, GrenadeKind.Incendiary })
{
    for (var count = 2; count >= 0; count--)
        Check(state.TryRecordThrow(7, kind, count, 1, out var consumed) && consumed == 1, $"actual {kind} inventory decrease {count}");
}
Check(state.RemainingTotal == 0, "knife transition requires all twelve throws confirmed by inventory");
Check(state.TryBeginKnife(7, 100), "knife allowed after all twelve grenades are spent");
Check(!state.TryBeginKnife(7, 100), "duplicate exhaustion event cannot issue a second knife this life");
Check(state.TryBeginKnife(7, 101), "a respawned life can receive its one knife after exhaustion");

var respawn = new GrenadeRoundState(7);
SetInventory(respawn, 7, 3, 3, 3, 3);
Check(respawn.TryBeginLoadout(7, 200, 2), "initial-life loadout");
Check(respawn.TryRecordThrow(7, GrenadeKind.He, 2, 1, out _), "throw before death is observed");
Check(respawn.TryBeginLoadout(7, 201, 2), "new life gets a remaining-quota loadout");
CheckRemaining(respawn, 2, 3, 3, 3, "respawn retains round consumption");

Check(respawn.ResetForNewRound(8), "next engine round resets state even for the same life");
Check(!respawn.ResetForNewRound(8), "duplicate round-start identity is ignored");
CheckRemaining(respawn, 3, 3, 3, 3, "new round restores full quota");
Check(!respawn.TryRecordThrow(7, GrenadeKind.Incendiary, 2, 1, out _), "stale prior-round event cannot mutate current state");
Check(!respawn.TryRecordThrow(8, GrenadeKind.Incendiary, 2, 1, out _), "throw is not counted before a verified loadout inventory baseline");
SetInventory(respawn, 8, 3, 3, 3, 3);
Check(respawn.TryBeginLoadout(8, 201, 2), "same life may receive the next round's set");
Check(respawn.TryRecordThrow(8, GrenadeKind.Incendiary, 2, 1, out _), "current-round event is recorded from inventory delta");

var deathDrop = new GrenadeRoundState(9);
SetInventory(deathDrop, 9, 3, 3, 3, 3);
Check(deathDrop.TryRecordThrow(9, GrenadeKind.He, 0, 1, out var eventBacked) && eventBacked == 1,
    "inventory lost at death is bounded by actual matching throw events");
CheckRemaining(deathDrop, 2, 3, 3, 3, "death does not falsely consume the whole quota");

// A reconnecting player keeps the round entitlement: only unthrown grenades are re-issued,
// and the next round still restores the full set.
var reconnect = new GrenadeRoundState(5);
SetInventory(reconnect, 5, 3, 3, 3, 3);
Check(reconnect.TryBeginLoadout(5, 300, 2), "pre-disconnect loadout");
Check(reconnect.TryRecordThrow(5, GrenadeKind.He, 2, 1, out _), "throw before disconnect is observed");
Check(reconnect.TryBeginLoadout(5, 301, 2), "reconnect in the same round receives only the remaining quota");
CheckRemaining(reconnect, 2, 3, 3, 3, "reconnect does not refill the spent grenade");
Check(reconnect.ResetForNewRound(6), "the round after the reconnect resets the entitlement");
CheckRemaining(reconnect, 3, 3, 3, 3, "a new round restores the full set for the reconnected player");

Console.WriteLine("DuelPlayGrenadeOnly state scenarios: PASS (inventory-backed throw, duplicate events, per-type quotas, knife timing, respawn, team change, round identity, stale event rejection, reconnect)");
