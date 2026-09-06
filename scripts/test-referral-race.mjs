import assert from "node:assert/strict";
import { referralRaceMonthKey, referralRaceWindow, rankReferralRace } from "../lib/referral-race.ts";
assert.equal(referralRaceMonthKey(new Date("2026-09-06T12:00:00Z")), "2026-09");
assert.throws(() => referralRaceWindow("2026-13"), /INVALID_MONTH/);
const { month, next } = referralRaceWindow("2026-08");
assert.equal(month.toISOString(), "2026-08-01T00:00:00.000Z");
assert.equal(next.toISOString(), "2026-09-01T00:00:00.000Z");
const ranked = rankReferralRace([
  { id: "b", nickname: "Beta", invited: 3 },
  { id: "a", nickname: "Alpha", invited: 3 },
  { id: "c", nickname: "Gamma", invited: 1 },
]);
assert.deepEqual(ranked.map(x => [x.position, x.id, x.prize]), [[1,"a",100],[2,"b",50],[3,"c",25]]);
console.log("referral-race: PASS");
