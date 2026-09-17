import assert from 'node:assert/strict';
import { boostedXpAmount, boosterIsActive, getXpBoosterPlan } from '../lib/xp-booster.ts';

assert.equal(boostedXpAmount(100, 2), 200);
assert.equal(boostedXpAmount(25, 3), 75);
assert.equal(boostedXpAmount(99, 1.5), 148);
assert.equal(boostedXpAmount(-10, 3), 0);
assert.equal(boostedXpAmount(100, 0), 100);
assert.equal(getXpBoosterPlan('2x24').hours, 24);
assert.equal(getXpBoosterPlan('3x24').multiplier, 3);
assert.equal(getXpBoosterPlan('bad'), null);
const now = new Date('2026-09-06T12:00:00.000Z');
assert.equal(boosterIsActive(new Date('2026-09-06T11:00:00.000Z'), new Date('2026-09-06T13:00:00.000Z'), now), true);
assert.equal(boosterIsActive(new Date('2026-09-06T11:00:00.000Z'), new Date('2026-09-06T12:00:00.000Z'), now), false);
console.log('xp-booster: PASS');
