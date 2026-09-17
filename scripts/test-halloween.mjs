import assert from 'node:assert/strict';
import { HALLOWEEN_EVENT, halloweenWindow, isHalloweenEvent } from '../lib/halloween.ts';

assert.equal(HALLOWEEN_EVENT.eventPass, true);
assert.equal(HALLOWEEN_EVENT.premiumPass, true);
assert.equal(HALLOWEEN_EVENT.promoMultiplier, 1.5);
assert.equal(HALLOWEEN_EVENT.caseSlug, 'halloween-case');
assert.equal(HALLOWEEN_EVENT.missions.length, 4);
assert.equal(HALLOWEEN_EVENT.rewards.length, 5);
const w = halloweenWindow(2026);
assert.equal(w.startsAt.toISOString(), '2026-10-31T00:00:00.000Z');
assert.equal(w.endsAt.toISOString(), '2026-11-03T00:00:00.000Z');
assert.equal(isHalloweenEvent({ name: 'Halloween', theme: 'HALLOWEEN' }), true);
assert.equal(isHalloweenEvent({ name: 'Halloween', theme: 'WINTER' }), false);
console.log('halloween: PASS');
