import assert from 'node:assert/strict';
const season = (id, mode, active, start, end) => ({id,name:id,theme:'winter',mode,active,effects:null,startsAt:new Date(start),endsAt:new Date(end)});
const { chooseEffectiveSeason, isSeasonEffective, normalizeSeasonEffects } = await import('../lib/season-policy.ts');
const now = new Date('2026-09-06T12:00:00Z');
assert.equal(isSeasonEffective(season('off','OFF',true,'2026-09-01','2026-10-01'),now),false);
assert.equal(isSeasonEffective(season('manual-off','MANUAL',false,'2026-09-01','2026-10-01'),now),false);
assert.equal(isSeasonEffective(season('auto','AUTO',false,'2026-09-01','2026-10-01'),now),true);
assert.equal(chooseEffectiveSeason([
  season('auto','AUTO',false,'2026-09-01','2026-10-01'),
  season('manual','MANUAL',true,'2026-09-01','2026-10-01'),
],now).id,'manual');
assert.equal(chooseEffectiveSeason([
  season('old','AUTO',false,'2026-08-01','2026-10-01'),
  season('new','AUTO',false,'2026-09-01','2026-10-01'),
],now).id,'new');
assert.throws(()=>normalizeSeasonEffects('bad'));
console.log('season-policy: PASS');
