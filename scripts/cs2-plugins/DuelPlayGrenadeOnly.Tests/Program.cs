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

static void ThrowOne(GrenadeRoundState state, long roundId, GrenadeKind kind, int inventoryAfter)
{
    Check(state.NoteThrow(roundId, kind), $"{kind}: note one throw");
    Check(state.TryRecordThrow(roundId, kind, inventoryAfter, out var consumed) && consumed == 1, $"{kind}: record one throw");
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
Check(loadout.IsLoadoutCommitted(100), "a committed life is reported committed so a respawn retry stops");
Check(!loadout.IsLoadoutCommitted(999), "an uncommitted life is not reported committed");
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
Check(loadout.HasKnifeBeenGranted(100), "the attempted knife is reported for this life");
Check(!loadout.HasKnifeBeenGranted(101), "a new life has not attempted a knife yet");
Check(!loadout.TryBeginKnife(7, 100), "duplicate exhaustion event cannot issue a second knife this life");
Check(loadout.TryBeginKnife(7, 101), "a respawned life can receive its one knife after exhaustion");
Check(loadout.HasKnifeBeenGranted(101), "the respawned life reports its knife attempt");

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
Check(!shortGrant.IsLoadoutCommitted(300), "an aborted grant is not reported committed");
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

// Respawn regression (issue: a respawn spawned with zero grenades). Covers, in order:
// 1) the round starts with twelve grenades; 2) six spent; 3) exact per-type remainder after
// a same-round respawn (1 HE / 2 flash / 1 smoke / 3 incendiary); 4) a throw still pending at
// death is finalized once and a late callback cannot read the re-issued kit; 5) duplicate
// death/spawn events are idempotent; 6) an exhausted entitlement gets no grenades and one
// knife per life; 7) the knife stays locked while grenades remain; 8) the next round is full.
var respawn = new GrenadeRoundState(12);
Complete(respawn, 12, 700, 2, 3, 3, 3, 3);

Check(respawn.NoteThrow(12, GrenadeKind.He), "respawn: first HE throw noted");
Check(respawn.TryRecordThrow(12, GrenadeKind.He, 2, out var heConsumed) && heConsumed == 1, "respawn: first HE throw confirmed");
Check(respawn.NoteThrow(12, GrenadeKind.He), "respawn: second HE throw noted");
Check(respawn.TryRecordThrow(12, GrenadeKind.He, 1, out heConsumed) && heConsumed == 1, "respawn: second HE throw confirmed");
Check(respawn.NoteThrow(12, GrenadeKind.Flash), "respawn: flash throw noted");
Check(respawn.TryRecordThrow(12, GrenadeKind.Flash, 2, out var flashConsumed) && flashConsumed == 1, "respawn: flash throw confirmed");
Check(respawn.NoteThrow(12, GrenadeKind.Smoke), "respawn: first smoke throw noted");
Check(respawn.TryRecordThrow(12, GrenadeKind.Smoke, 2, out var smokeConsumed) && smokeConsumed == 1, "respawn: first smoke throw confirmed");
Check(respawn.NoteThrow(12, GrenadeKind.Smoke), "respawn: second smoke throw noted");
Check(respawn.TryRecordThrow(12, GrenadeKind.Smoke, 1, out smokeConsumed) && smokeConsumed == 1, "respawn: second smoke throw confirmed");
CheckRemaining(respawn, 1, 2, 1, 3, "respawn: six throws leave an exact per-type remainder");

Check(respawn.NoteThrow(12, GrenadeKind.He), "respawn: third HE throw still pending at death");
Check(respawn.FinalizePendingThrows(12) == 1, "respawn: death finalizes the pending throw");
Check(respawn.FinalizePendingThrows(12) == 0, "respawn: duplicate death event is idempotent");
CheckRemaining(respawn, 0, 2, 1, 3, "respawn: pending throw is spent exactly once");
Check(!respawn.TryRecordThrow(12, GrenadeKind.He, 3, out _), "respawn: a late callback cannot charge against the re-issued kit");

Check(respawn.TryBeginLoadout(12, 701, 2), "respawn: reserve the new life");
Check(!respawn.CompleteLoadout(12, 701, Inventory(3, 3, 3, 3)), "respawn: a full refill cannot be committed");
Check(respawn.AbortLoadout(12, 701), "respawn: rejected refill releases the reservation");
Complete(respawn, 12, 701, 2, 0, 2, 1, 3);
CheckRemaining(respawn, 0, 2, 1, 3, "respawn: only the exact remaining kit is retained");
Check(!respawn.TryBeginLoadout(12, 701, 2), "respawn: duplicate spawn events cannot reapply the kit");
Check(!respawn.TryBeginKnife(12, 701), "respawn: knife stays locked while grenades remain");

var exhausted = new GrenadeRoundState(13);
Complete(exhausted, 13, 800, 2, 3, 3, 3, 3);
foreach (var kind in Enum.GetValues<GrenadeKind>())
{
    for (var count = 2; count >= 0; count--)
    {
        Check(exhausted.NoteThrow(13, kind), $"exhausted: note {kind} throw");
        Check(exhausted.TryRecordThrow(13, kind, count, out var spent) && spent == 1, $"exhausted: confirm {kind} throw");
    }
}
Check(exhausted.RemainingTotal == 0, "exhausted: all twelve grenades are spent");
Check(!exhausted.TryBeginLoadout(13, 801, 2), "exhausted: no grenade loadout for an empty entitlement");
Check(exhausted.TryBeginKnife(13, 801), "exhausted: knife allowed after all grenades are spent");
Check(!exhausted.TryBeginKnife(13, 801), "exhausted: knife is issued once per life");

Check(respawn.ResetForNewRound(13), "next round resets the entitlement");
CheckRemaining(respawn, 3, 3, 3, 3, "next round restores the full twelve-grenade kit");
Complete(respawn, 13, 702, 2, 3, 3, 3, 3);
CheckRemaining(respawn, 3, 3, 3, 3, "next round commits the full kit again");

// Exact total-remaining thresholds. 2/6/9/11/12 throws must leave 10/6/3/1/0 grenades,
// with the per-type remainder checked independently at every step.
var thresholds = new GrenadeRoundState(14);
Complete(thresholds, 14, 900, 2, 3, 3, 3, 3);

ThrowOne(thresholds, 14, GrenadeKind.He, 2);
ThrowOne(thresholds, 14, GrenadeKind.He, 1);
Check(thresholds.RemainingTotal == 10, "2 thrown leaves exactly 10 grenades");
CheckRemaining(thresholds, 1, 3, 3, 3, "2 thrown leaves 1 HE and untouched other types");

ThrowOne(thresholds, 14, GrenadeKind.Flash, 2);
ThrowOne(thresholds, 14, GrenadeKind.Flash, 1);
ThrowOne(thresholds, 14, GrenadeKind.Flash, 0);
ThrowOne(thresholds, 14, GrenadeKind.Smoke, 2);
Check(thresholds.RemainingTotal == 6, "6 thrown leaves exactly 6 grenades");
CheckRemaining(thresholds, 1, 0, 2, 3, "6 thrown leaves the exact per-type remainder");

ThrowOne(thresholds, 14, GrenadeKind.Smoke, 1);
ThrowOne(thresholds, 14, GrenadeKind.Smoke, 0);
ThrowOne(thresholds, 14, GrenadeKind.Incendiary, 2);
Check(thresholds.RemainingTotal == 3, "9 thrown leaves exactly 3 grenades");
CheckRemaining(thresholds, 1, 0, 0, 2, "9 thrown leaves 1 HE and 2 incendiary");

ThrowOne(thresholds, 14, GrenadeKind.Incendiary, 1);
ThrowOne(thresholds, 14, GrenadeKind.Incendiary, 0);
Check(thresholds.RemainingTotal == 1, "11 thrown leaves exactly 1 grenade");
CheckRemaining(thresholds, 1, 0, 0, 0, "11 thrown leaves only HE");
Check(!thresholds.TryBeginKnife(14, 900), "knife is forbidden while one grenade remains");

ThrowOne(thresholds, 14, GrenadeKind.He, 0);
Check(thresholds.RemainingTotal == 0, "12 thrown leaves no grenades");
CheckRemaining(thresholds, 0, 0, 0, 0, "12 thrown empties every type");
Check(thresholds.TryBeginKnife(14, 900), "knife is issued once all twelve grenades are spent");
Check(!thresholds.TryBeginKnife(14, 900), "the exhausted life cannot receive a second knife");

// Last-grenade regression (issue: the final remaining grenade was not throwable). The
// entitlement must show exactly one grenade, reject duplicate/spurious callbacks, survive
// a same-round respawn with exactly that grenade, and only then unlock the knife.
var lastGrenade = new GrenadeRoundState(18);
Complete(lastGrenade, 18, 1200, 2, 3, 3, 3, 3);
for (var i = 0; i < 3; i++) ThrowOne(lastGrenade, 18, GrenadeKind.He, 2 - i);
for (var i = 0; i < 3; i++) ThrowOne(lastGrenade, 18, GrenadeKind.Flash, 2 - i);
for (var i = 0; i < 2; i++) ThrowOne(lastGrenade, 18, GrenadeKind.Smoke, 2 - i);
for (var i = 0; i < 3; i++) ThrowOne(lastGrenade, 18, GrenadeKind.Incendiary, 2 - i);
Check(lastGrenade.RemainingTotal == 1, "last grenade: eleven throws leave exactly one grenade");
CheckRemaining(lastGrenade, 0, 0, 1, 0, "last grenade: the final grenade is smoke");
Check(!lastGrenade.TryBeginKnife(18, 1200), "last grenade: knife stays locked while it remains");
Check(!lastGrenade.TryRecordThrow(18, GrenadeKind.Smoke, 0, out _), "last grenade: a duplicate callback cannot consume it without a new throw event");
Complete(lastGrenade, 18, 1201, 2, 0, 0, 1, 0);
CheckRemaining(lastGrenade, 0, 0, 1, 0, "last grenade: a respawn retains exactly the final grenade");
Check(!lastGrenade.TryBeginKnife(18, 1201), "last grenade: a respawn does not unlock the knife early");
ThrowOne(lastGrenade, 18, GrenadeKind.Smoke, 0);
CheckRemaining(lastGrenade, 0, 0, 0, 0, "last grenade: the twelfth throw empties the kit");
Check(!lastGrenade.NoteThrow(18, GrenadeKind.Smoke), "last grenade: a repeated throw event after exhaustion is rejected");
Check(lastGrenade.TryBeginKnife(18, 1201), "last grenade: the knife unlocks after the final throw");

// Re-deploy targets (issue: with one type left the engine's post-throw auto-switch deploys
// nothing, so the fix re-selects a real classname). The state must expose exactly the last
// remaining type as the deploy target, prefer a stocked just-thrown type, and map it to the
// correct side-specific CS2 classname.
var redeploy = new GrenadeRoundState(20);
Complete(redeploy, 20, 1400, 2, 3, 3, 3, 3);
Check(redeploy.RemainingKinds().Count == 4, "re-deploy: a full kit offers all four grenade kinds");
for (var i = 0; i < 3; i++) ThrowOne(redeploy, 20, GrenadeKind.He, 2 - i);
for (var i = 0; i < 3; i++) ThrowOne(redeploy, 20, GrenadeKind.Flash, 2 - i);
for (var i = 0; i < 2; i++) ThrowOne(redeploy, 20, GrenadeKind.Smoke, 2 - i);
for (var i = 0; i < 3; i++) ThrowOne(redeploy, 20, GrenadeKind.Incendiary, 2 - i);
Check(redeploy.RemainingTotal == 1, "re-deploy: eleven throws leave one grenade");
var lastKinds = redeploy.RemainingKinds();
Check(lastKinds.Count == 1 && lastKinds[0] == GrenadeKind.Smoke, "re-deploy: the only remaining kind is exposed as the deploy target");
Check(redeploy.NextDeployTarget() == GrenadeKind.Smoke, "re-deploy: the last grenade is deployable by default");
Check(redeploy.NextDeployTarget(GrenadeKind.Smoke) == GrenadeKind.Smoke, "re-deploy: a preferred remaining type is kept");
ThrowOne(redeploy, 20, GrenadeKind.Smoke, 0);
Check(redeploy.RemainingKinds().Count == 0, "re-deploy: an exhausted kit exposes no target");
Check(redeploy.NextDeployTarget() is null, "re-deploy: nothing can be deployed once every grenade is spent");

var preference = new GrenadeRoundState(21);
Complete(preference, 21, 1500, 2, 3, 3, 3, 3);
ThrowOne(preference, 21, GrenadeKind.Flash, 2);
Check(preference.NextDeployTarget(GrenadeKind.Flash) == GrenadeKind.Flash, "preference: a stocked just-thrown type wins");
Check(preference.NextDeployTarget(GrenadeKind.Smoke) == GrenadeKind.Smoke, "preference: any stocked preferred type wins");
Check(preference.NextDeployTarget(GrenadeKind.Incendiary) == GrenadeKind.Incendiary, "preference: incendiary can be preferred too");
Check(preference.NextDeployTarget(null) == GrenadeKind.He, "preference: without a hint the first remaining kind is chosen");
ThrowOne(preference, 21, GrenadeKind.He, 2);
ThrowOne(preference, 21, GrenadeKind.He, 1);
ThrowOne(preference, 21, GrenadeKind.He, 0);
Check(preference.NextDeployTarget(GrenadeKind.He) == GrenadeKind.Flash, "preference: a spent preferred type falls back to the next remaining kind");

Check(GrenadeCatalog.Classname(GrenadeKind.He, false) == "weapon_hegrenade", "catalog: HE classname");
Check(GrenadeCatalog.Classname(GrenadeKind.Flash, false) == "weapon_flashbang", "catalog: flash classname");
Check(GrenadeCatalog.Classname(GrenadeKind.Smoke, true) == "weapon_smokegrenade", "catalog: smoke classname");
Check(GrenadeCatalog.Classname(GrenadeKind.Incendiary, true) == "weapon_molotov", "catalog: T incendiary is a molotov");
Check(GrenadeCatalog.Classname(GrenadeKind.Incendiary, false) == "weapon_incgrenade", "catalog: CT incendiary is an incgrenade");

// First-round vs second-round regression (issue: the first real round stalled after ten
// throws with two grenades left, while the next round threw all twelve). The engine log
// shows the client stops sending sv_throw_* exactly when a throw leaves a single kind
// with ammo still remaining, even though the server keeps reporting the stale, already
// thrown grenade as the active weapon. The deploy decision must force a re-select in that
// state and trust the engine's own auto-switch everywhere else. The sequences below replay
// the exact throw order recorded in log-DuelPlayGrenadeOnly on cs2-3.
var firstRound = new GrenadeRoundState(22);
Complete(firstRound, 22, 1600, 2, 3, 3, 3, 3);
ThrowOne(firstRound, 22, GrenadeKind.He, 2);
Check(!firstRound.NeedsRedeployAfterThrow(GrenadeKind.He), "first round: a throw with other kinds left stays in sync");
ThrowOne(firstRound, 22, GrenadeKind.Flash, 2);
Check(!firstRound.NeedsRedeployAfterThrow(GrenadeKind.Flash), "first round: flash throw with other kinds left stays in sync");
ThrowOne(firstRound, 22, GrenadeKind.He, 1);
Check(!firstRound.NeedsRedeployAfterThrow(GrenadeKind.He), "first round: second HE throw with other kinds left stays in sync");
ThrowOne(firstRound, 22, GrenadeKind.Smoke, 2);
Check(!firstRound.NeedsRedeployAfterThrow(GrenadeKind.Smoke), "first round: smoke throw with other kinds left stays in sync");
ThrowOne(firstRound, 22, GrenadeKind.He, 0);
Check(firstRound.NeedsRedeployAfterThrow(GrenadeKind.He), "first round: an exhausted active kind forces a re-select");
ThrowOne(firstRound, 22, GrenadeKind.Flash, 1);
Check(!firstRound.NeedsRedeployAfterThrow(GrenadeKind.Flash), "first round: flash throw with other kinds left stays in sync");
ThrowOne(firstRound, 22, GrenadeKind.Smoke, 1);
Check(!firstRound.NeedsRedeployAfterThrow(GrenadeKind.Smoke), "first round: second smoke throw with other kinds left stays in sync");
ThrowOne(firstRound, 22, GrenadeKind.Flash, 0);
Check(firstRound.NeedsRedeployAfterThrow(GrenadeKind.Flash), "first round: exhausted flash before the last kind forces a re-select");
ThrowOne(firstRound, 22, GrenadeKind.Smoke, 0);
Check(firstRound.RemainingKinds() is { Count: 1 } && firstRound.NeedsRedeployAfterThrow(GrenadeKind.Smoke), "first round: the throw that leaves one kind forces a re-select");
// The tenth throw is the live stall: kinds=1 with ammo still remaining. The server still
// reports the just-thrown incendiary as active, so the decision must still force a re-select.
ThrowOne(firstRound, 22, GrenadeKind.Incendiary, 2);
CheckRemaining(firstRound, 0, 0, 0, 2, "first round: ten throws leave two incendiaries");
Check(firstRound.NeedsRedeployAfterThrow(GrenadeKind.Incendiary), "first round: a single kind with ammo left forces a re-select (the stalled case)");
Check(firstRound.NextDeployTarget(GrenadeKind.Incendiary) == GrenadeKind.Incendiary, "first round: the re-select targets the remaining incendiary");
ThrowOne(firstRound, 22, GrenadeKind.Incendiary, 1);
Check(firstRound.NeedsRedeployAfterThrow(GrenadeKind.Incendiary), "first round: the eleventh throw still forces a re-select");
ThrowOne(firstRound, 22, GrenadeKind.Incendiary, 0);
Check(!firstRound.NeedsRedeployAfterThrow(null), "first round: no re-select is needed once every grenade is thrown");

var secondRound = new GrenadeRoundState(23);
Complete(secondRound, 23, 1700, 2, 3, 3, 3, 3);
ThrowOne(secondRound, 23, GrenadeKind.He, 2);
ThrowOne(secondRound, 23, GrenadeKind.Flash, 2);
ThrowOne(secondRound, 23, GrenadeKind.He, 1);
ThrowOne(secondRound, 23, GrenadeKind.Flash, 1);
ThrowOne(secondRound, 23, GrenadeKind.Smoke, 2);
ThrowOne(secondRound, 23, GrenadeKind.Incendiary, 2);
ThrowOne(secondRound, 23, GrenadeKind.He, 0);
Check(secondRound.NeedsRedeployAfterThrow(GrenadeKind.He), "second round: exhausted HE forces a re-select");
ThrowOne(secondRound, 23, GrenadeKind.Flash, 0);
Check(secondRound.NeedsRedeployAfterThrow(GrenadeKind.Flash), "second round: exhausted flash forces a re-select");
ThrowOne(secondRound, 23, GrenadeKind.Incendiary, 1);
Check(!secondRound.NeedsRedeployAfterThrow(GrenadeKind.Incendiary), "second round: a remaining kind among two stays in sync");
ThrowOne(secondRound, 23, GrenadeKind.Smoke, 1);
Check(!secondRound.NeedsRedeployAfterThrow(GrenadeKind.Smoke), "second round: a remaining kind among two stays in sync");
ThrowOne(secondRound, 23, GrenadeKind.Incendiary, 0);
Check(secondRound.RemainingKinds() is { Count: 1 } && secondRound.NeedsRedeployAfterThrow(GrenadeKind.Incendiary), "second round: the throw that leaves one kind forces a re-select");
ThrowOne(secondRound, 23, GrenadeKind.Smoke, 0);
CheckRemaining(secondRound, 0, 0, 0, 0, "second round: all twelve throws empty the kit");
Check(!secondRound.NeedsRedeployAfterThrow(null), "second round: no re-select after the twelfth throw");

// A missing engine report must never leave the client unsynced.
Check(preference.NeedsRedeployAfterThrow(null), "a null active weapon with grenades left forces a re-select");

// The final throw may still be pending at death; it must be spent, not refilled on respawn.
var lastPending = new GrenadeRoundState(19);
Complete(lastPending, 19, 1300, 2, 3, 3, 3, 3);
for (var i = 0; i < 3; i++) ThrowOne(lastPending, 19, GrenadeKind.He, 2 - i);
for (var i = 0; i < 3; i++) ThrowOne(lastPending, 19, GrenadeKind.Flash, 2 - i);
for (var i = 0; i < 3; i++) ThrowOne(lastPending, 19, GrenadeKind.Smoke, 2 - i);
for (var i = 0; i < 2; i++) ThrowOne(lastPending, 19, GrenadeKind.Incendiary, 2 - i);
Check(lastPending.NoteThrow(19, GrenadeKind.Incendiary), "last grenade: the final throw is noted but not yet observed at death");
Check(lastPending.FinalizePendingThrows(19) == 1, "last grenade: death finalizes the pending final throw exactly once");
Check(lastPending.RemainingTotal == 0, "last grenade: the death-finalized final throw leaves no grenade");
Check(!lastPending.TryBeginLoadout(19, 1301, 2), "last grenade: a respawn cannot reserve a refill after the final throw");
Check(lastPending.TryBeginKnife(19, 1301), "last grenade: the death-finalized final throw unlocks the knife");

// Repeated death/spawn/team events cannot refill or change the per-type remainder.
var repeated = new GrenadeRoundState(15);
Complete(repeated, 15, 1000, 2, 3, 3, 3, 3);
ThrowOne(repeated, 15, GrenadeKind.He, 2);
ThrowOne(repeated, 15, GrenadeKind.He, 1);
ThrowOne(repeated, 15, GrenadeKind.Flash, 2);
ThrowOne(repeated, 15, GrenadeKind.Smoke, 2);
ThrowOne(repeated, 15, GrenadeKind.Smoke, 1);
ThrowOne(repeated, 15, GrenadeKind.Incendiary, 2);
CheckRemaining(repeated, 1, 2, 1, 2, "repeated events start from an exact six-grenade remainder");
Check(repeated.FinalizePendingThrows(15) == 0, "death without pending callbacks changes nothing");
Check(repeated.FinalizePendingThrows(15) == 0, "a duplicate death event is idempotent");

Check(repeated.TryBeginLoadout(15, 1001, 2), "first respawn reserves the remaining kit");
Check(!repeated.CompleteLoadout(15, 1001, Inventory(3, 3, 3, 3)), "first respawn cannot commit a full refill");
Check(repeated.AbortLoadout(15, 1001), "rejected refill aborts the reservation");
Complete(repeated, 15, 1001, 2, 1, 2, 1, 2);
CheckRemaining(repeated, 1, 2, 1, 2, "first respawn keeps the exact per-type remainder");
Check(!repeated.TryBeginLoadout(15, 1001, 2), "duplicate spawn for the committed life is ignored");
Check(!repeated.TryBeginLoadout(15, 1001, 2), "another duplicate spawn is ignored");
Complete(repeated, 15, 1002, 2, 1, 2, 1, 2);
CheckRemaining(repeated, 1, 2, 1, 2, "a second respawn keeps the same per-type remainder");
Check(repeated.FinalizePendingThrows(15) == 0, "a second death does not return any grenade");
Check(!repeated.TryBeginLoadout(15, 1002, 2), "duplicate spawn after the second respawn is ignored");

Check(repeated.ResetForNewRound(16), "only a new round resets the entitlement");
CheckRemaining(repeated, 3, 3, 3, 3, "new round restores all twelve grenades");
Check(repeated.TryBeginLoadout(16, 1003, 2), "new round reserves a full kit");
Check(repeated.CompleteLoadout(16, 1003, Inventory(3, 3, 3, 3)), "new round commits the full kit");

// Multiple deaths with throws in between: every respawn must resume the exact remainder,
// never refill, and be reported committed so the spawn-loadout retry stops immediately.
var multiDeath = new GrenadeRoundState(25);
Complete(multiDeath, 25, 1900, 2, 3, 3, 3, 3);
Check(multiDeath.RemainingTotal == 12, "multi-death: round starts with twelve grenades");

ThrowOne(multiDeath, 25, GrenadeKind.He, 2);
ThrowOne(multiDeath, 25, GrenadeKind.Flash, 2);
Check(multiDeath.FinalizePendingThrows(25) == 0, "multi-death: first death has no pending throw");
Complete(multiDeath, 25, 1901, 2, 2, 2, 3, 3);
CheckRemaining(multiDeath, 2, 2, 3, 3, "multi-death: first respawn keeps the exact remainder");
Check(multiDeath.IsLoadoutCommitted(1901), "multi-death: first respawn is committed so the retry stops");

ThrowOne(multiDeath, 25, GrenadeKind.He, 1);
Check(multiDeath.NoteThrow(25, GrenadeKind.Smoke), "multi-death: a throw is pending at the second death");
Check(multiDeath.FinalizePendingThrows(25) == 1, "multi-death: second death finalizes the pending throw");
Check(multiDeath.FinalizePendingThrows(25) == 0, "multi-death: a duplicate second death is idempotent");
CheckRemaining(multiDeath, 1, 2, 2, 3, "multi-death: the pending throw is spent before the second respawn");
Complete(multiDeath, 25, 1902, 2, 1, 2, 2, 3);
CheckRemaining(multiDeath, 1, 2, 2, 3, "multi-death: second respawn keeps the exact remainder");
Check(multiDeath.IsLoadoutCommitted(1902), "multi-death: second respawn is committed so the retry stops");
Check(multiDeath.IsLoadoutCommitted(1901), "multi-death: the earlier committed life stays committed");

ThrowOne(multiDeath, 25, GrenadeKind.He, 0);
ThrowOne(multiDeath, 25, GrenadeKind.Flash, 1);
ThrowOne(multiDeath, 25, GrenadeKind.Flash, 0);
ThrowOne(multiDeath, 25, GrenadeKind.Smoke, 1);
ThrowOne(multiDeath, 25, GrenadeKind.Smoke, 0);
ThrowOne(multiDeath, 25, GrenadeKind.Incendiary, 2);
ThrowOne(multiDeath, 25, GrenadeKind.Incendiary, 1);
Check(!multiDeath.TryBeginKnife(25, 1902), "multi-death: knife stays locked while one grenade remains");
ThrowOne(multiDeath, 25, GrenadeKind.Incendiary, 0);
Check(multiDeath.RemainingTotal == 0, "multi-death: the third life can spend the whole remainder");
Check(multiDeath.TryBeginKnife(25, 1902), "multi-death: the knife unlocks only after the last grenade");
Check(!multiDeath.TryBeginKnife(25, 1902), "multi-death: the knife is issued once per life");

// A throw confirmed late for an old life must not consume from the re-issued respawn kit.
var lateThrow = new GrenadeRoundState(17);
Complete(lateThrow, 17, 1100, 2, 3, 3, 3, 3);
Check(lateThrow.NoteThrow(17, GrenadeKind.He), "old-life throw is noted before death");
Check(lateThrow.FinalizePendingThrows(17) == 1, "death finalizes the old-life throw exactly once");
Complete(lateThrow, 17, 1101, 2, 2, 3, 3, 3);
Check(!lateThrow.TryRecordThrow(17, GrenadeKind.He, 3, out _), "old-life callback cannot consume from the new kit");
Check(!lateThrow.TryRecordThrow(17, GrenadeKind.He, 2, out _), "old-life callback with the re-issued count is rejected");
CheckRemaining(lateThrow, 2, 3, 3, 3, "late old-life callbacks leave the respawn kit untouched");

Check(lateThrow.NoteThrow(17, GrenadeKind.Flash), "new-life flash throw is noted");
Check(lateThrow.TryRecordThrow(17, GrenadeKind.Flash, 2, out var lateFlash) && lateFlash == 1, "new-life throw is recorded once");
Check(!lateThrow.TryRecordThrow(17, GrenadeKind.Flash, 2, out _), "duplicate deferred confirmation cannot double-debit");
CheckRemaining(lateThrow, 2, 2, 3, 3, "duplicate confirmation leaves the per-type remainder intact");

// Respawn inside the round with two of the last remaining kind (the live "2 incendiaries
// left, player dies" case). The fix must keep both grenades instead of refilling, force a
// re-select on the new life, and still unlock the knife only after the second is thrown.
var singleKindRespawn = new GrenadeRoundState(24);
Complete(singleKindRespawn, 24, 1800, 2, 3, 3, 3, 3);
for (var i = 0; i < 3; i++) ThrowOne(singleKindRespawn, 24, GrenadeKind.He, 2 - i);
for (var i = 0; i < 3; i++) ThrowOne(singleKindRespawn, 24, GrenadeKind.Flash, 2 - i);
for (var i = 0; i < 3; i++) ThrowOne(singleKindRespawn, 24, GrenadeKind.Smoke, 2 - i);
ThrowOne(singleKindRespawn, 24, GrenadeKind.Incendiary, 2);
CheckRemaining(singleKindRespawn, 0, 0, 0, 2, "single-kind respawn: two incendiaries remain before death");
Check(singleKindRespawn.NeedsRedeployAfterThrow(GrenadeKind.Incendiary), "single-kind respawn: a single surviving kind forces a re-select");
Check(singleKindRespawn.FinalizePendingThrows(24) == 0, "single-kind respawn: death with no pending throw keeps the remainder");
Complete(singleKindRespawn, 24, 1801, 2, 0, 0, 0, 2);
CheckRemaining(singleKindRespawn, 0, 0, 0, 2, "single-kind respawn: the new life resumes with exactly two incendiaries");
Check(!singleKindRespawn.TryBeginKnife(24, 1801), "single-kind respawn: knife stays locked while two grenades remain");
Check(singleKindRespawn.NeedsRedeployAfterThrow(GrenadeKind.Incendiary), "single-kind respawn: the re-issued life still needs a re-select");
ThrowOne(singleKindRespawn, 24, GrenadeKind.Incendiary, 1);
Check(singleKindRespawn.NeedsRedeployAfterThrow(GrenadeKind.Incendiary), "single-kind respawn: the penultimate throw still needs a re-select");
ThrowOne(singleKindRespawn, 24, GrenadeKind.Incendiary, 0);
Check(!singleKindRespawn.NeedsRedeployAfterThrow(null), "single-kind respawn: no re-select after the final throw");
Check(singleKindRespawn.TryBeginKnife(24, 1801), "single-kind respawn: the knife unlocks after the final incendiary");

// Exhausted-entitlement respawns (the live 09:57:54 -> 09:58:01 case). Every new life
// must get exactly one knife, no grenades may be re-issued, and only a real new round may
// restore the full twelve-grenade kit.
var zeroLives = new GrenadeRoundState(26);
Complete(zeroLives, 26, 2000, 2, 3, 3, 3, 3);
foreach (var kind in Enum.GetValues<GrenadeKind>())
{
    for (var count = 2; count >= 0; count--)
    {
        Check(zeroLives.NoteThrow(26, kind), $"zero lives: note {kind} throw");
        Check(zeroLives.TryRecordThrow(26, kind, count, out var spent) && spent == 1, $"zero lives: confirm {kind} throw");
    }
}
Check(zeroLives.RemainingTotal == 0, "zero lives: the first life exhausts the full kit");
foreach (var lifeId in new long[] { 2001, 2002, 2003 })
{
    Check(!zeroLives.TryBeginLoadout(26, lifeId, 2), $"zero lives: life {lifeId} cannot re-issue grenades");
    Check(zeroLives.TryBeginKnife(26, lifeId), $"zero lives: life {lifeId} gets its knife");
    Check(zeroLives.HasKnifeBeenGranted(lifeId), $"zero lives: life {lifeId} is marked as knife-served");
    Check(!zeroLives.TryBeginKnife(26, lifeId), $"zero lives: life {lifeId} cannot get a second knife");
}
CheckRemaining(zeroLives, 0, 0, 0, 0, "zero lives: three respawns still keep the kit empty");
Check(zeroLives.ResetForNewRound(27), "zero lives: a real new round resets the entitlement");
CheckRemaining(zeroLives, 3, 3, 3, 3, "zero lives: the next round restores the full twelve-grenade kit");
Check(zeroLives.TryBeginLoadout(27, 2004, 2), "zero lives: the next round reserves a full kit");
Check(zeroLives.CompleteLoadout(27, 2004, Inventory(3, 3, 3, 3)), "zero lives: the next round commits the full kit");
Check(!zeroLives.HasKnifeBeenGranted(2004), "zero lives: the next round starts with the grenade phase, not a knife");

Console.WriteLine("DuelPlayGrenadeOnly state scenarios: PASS (commit/abort loadout, committed-life reporting, inventory-backed throw, duplicate events, per-type quotas, 2/6/9/11/12 throw thresholds, last-grenade duplicate/respawn handling, re-deploy target and classname catalog, first-round vs second-round re-deploy decisions, single-kind respawn remainder and re-select, multi-death remainder with throws between deaths, death finalization, short-grant rejection, knife timing, exact respawn remainder, repeated death/spawn, exhausted respawn, multiple exhausted respawns, new-round refill, reconnect, round identity, stale event rejection)");
