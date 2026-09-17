import assert from 'node:assert/strict';
import { effectiveEventStatus, validateEventWindow, validateEventPayload, validateEventConfig, safeJson } from '../lib/events.ts';
const now = new Date('2026-09-06T12:00:00Z');
assert.equal(effectiveEventStatus('SCHEDULED', new Date('2026-09-06T11:00:00Z'), new Date('2026-09-06T13:00:00Z'), now), 'ACTIVE');
assert.equal(effectiveEventStatus('SCHEDULED', new Date('2026-09-06T09:00:00Z'), new Date('2026-09-06T10:00:00Z'), now), 'ENDED');
assert.equal(effectiveEventStatus('CANCELLED', new Date('2026-09-06T09:00:00Z'), new Date('2026-09-06T10:00:00Z'), now), 'CANCELLED');
assert.equal(effectiveEventStatus('DRAFT', new Date('2026-09-06T09:00:00Z'), new Date('2026-09-06T13:00:00Z'), now), 'DRAFT');
assert.equal(validateEventWindow(new Date('2026-01-01'), new Date('2026-01-02')), true);
assert.equal(validateEventWindow(new Date('2026-01-02'), new Date('2026-01-01')), false);
const valid = validateEventPayload({name:'Test', startsAt:'2026-09-06T12:00:00Z', endsAt:'2026-09-06T13:00:00Z', premiumPrice:5, promoMultiplier:2, eventPass:true, premiumPass:true});
assert.equal(valid.name, 'Test');
for (const bad of [
  {name:'',startsAt:'2026-09-06T12:00:00Z',endsAt:'2026-09-06T13:00:00Z'},
  {name:'x',startsAt:'bad',endsAt:'2026-09-06T13:00:00Z'},
  {name:'x',startsAt:'2026-09-06T12:00:00Z',endsAt:'2026-09-06T13:00:00Z',promoMultiplier:0},
  {name:'x',startsAt:'2026-09-06T12:00:00Z',endsAt:'2026-09-06T13:00:00Z',premiumPass:true,premiumPrice:1,eventPass:false},
]) assert.throws(()=>validateEventPayload(bad));
console.log('events: PASS');

assert.equal(validateEventConfig({ missions: [], rewards: [], effects: {}, leaderboard: {} }), true);
assert.throws(() => validateEventConfig({ missions: {} }));
assert.throws(() => validateEventConfig({ rewards: "bad" }));
assert.throws(() => safeJson({ broken: BigInt(1) }));
console.log('event-config: PASS');
