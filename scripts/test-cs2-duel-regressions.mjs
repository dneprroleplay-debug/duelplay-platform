import fs from 'node:fs';
import assert from 'node:assert/strict';

const page=fs.readFileSync('app/matches/[id]/page.tsx','utf8');
const join=fs.readFileSync('app/api/matches/[id]/join/route.ts','utf8');
const claim=fs.readFileSync('app/api/server-manager/claim/route.ts','utf8');
const manager=fs.readFileSync('scripts/server-manager/server-manager.mjs','utf8');

assert.match(page,/setInterval\(tick,2000\)/,'match page polls every 2 seconds');
assert.match(page,/fetch\(`\/api\/matches\/\$\{id\}\?t=\$\{Date\.now\(\)\}`/,'match polling bypasses stale cache');
assert.doesNotMatch(page,/setM\(d\.match\?\?d\)/,'join/start no longer installs partial API payload into UI');
assert.match(join,/include:\s*\{\s*playerOne:/,'join response contains player relations');
assert.match(claim,/weaponModifier:\s*match\.weaponModifier/,'manager receives weapon modifier');
assert.match(manager,/function applyDuelRules/,'manager applies duel rules');
assert.match(manager,/mp_t_default_primary weapon_awp/,'AWP mode gives AWP to T');
assert.match(manager,/mp_ct_default_primary weapon_awp/,'AWP mode gives AWP to CT');
assert.match(manager,/mp_buy_allow_guns 0/,'AWP mode disables weapon purchases');
assert.match(manager,/const timedOutMatchId = current\.id/,'technical timeout preserves match id');
assert.match(manager,/current\.id !== timedOutMatchId/,'technical timeout null guard uses saved id');
console.log('CS2 duel regression checks passed.');
