import assert from 'node:assert/strict';

const canRematch = ({ isRival, targetActive, acceptsChallenges }) =>
  isRival && targetActive && acceptsChallenges;

assert.equal(canRematch({ isRival: true, targetActive: true, acceptsChallenges: true }), true);
assert.equal(canRematch({ isRival: false, targetActive: true, acceptsChallenges: true }), false);
assert.equal(canRematch({ isRival: true, targetActive: false, acceptsChallenges: true }), false);
assert.equal(canRematch({ isRival: true, targetActive: true, acceptsChallenges: false }), false);

const statuses = ["ACTIVE", "REMOVED"];
assert.deepEqual(statuses, ["ACTIVE", "REMOVED"]);
console.log("rivals policy: PASS");
