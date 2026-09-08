import fs from 'node:fs';
import assert from 'node:assert/strict';

const page=fs.readFileSync('app/matches/[id]/page.tsx','utf8');
const join=fs.readFileSync('app/api/matches/[id]/join/route.ts','utf8');
const claim=fs.readFileSync('app/api/server-manager/claim/route.ts','utf8');
const manager=fs.readFileSync('scripts/server-manager/server-manager.mjs','utf8');

assert.match(page,/setInterval\(tick,1000\)/,'match page polls every second');
assert.match(page,/fetch\(`\/api\/matches\/\$\{id\}\?t=\$\{Date\.now\(\)\}`/,'match polling bypasses stale cache');
assert.match(page,/path==="join"&&d\?\.playerOne&&d\?\.playerTwo/,'join immediately renders both hydrated players');
assert.match(join,/include:\s*\{\s*playerOne:/,'join response contains player relations');
assert.match(claim,/weaponModifier:\s*match\.weaponModifier/,'manager receives weapon modifier');
assert.match(manager,/function applyDuelRules/,'manager applies duel rules');
assert.match(manager,/mp_t_default_primary weapon_awp/,'AWP mode gives AWP to T');
assert.match(manager,/mp_ct_default_primary weapon_awp/,'AWP mode gives AWP to CT');
assert.match(manager,/mp_buy_allow_guns 0/,'AWP mode disables weapon purchases');
assert.match(manager,/const timedOutMatchId = current\.id/,'technical timeout preserves match id');
assert.match(manager,/current\.id !== timedOutMatchId/,'technical timeout null guard uses saved id');
console.log('CS2 duel regression checks passed.');

const getRoute = fs.readFileSync('app/api/matches/[id]/route.ts','utf8');
assert.match(getRoute, /dynamic\s*=\s*["']force-dynamic["']/,'match GET is force-dynamic');
assert.match(getRoute, /Cache-Control.*no-store/,'match GET disables caches');
assert.match(page, /rungameid\/730/,'client launches CS2 directly via Steam rungameid');
assert.match(manager, /exec duelplay_awp/,'AWP mode loads dedicated AWP config');
assert.match(manager, /mp_warmup_online_enabled 0/,'warmup is disabled');
assert.match(manager, /mp_warmuptime 0/,'warmup duration is zero');
assert.match(manager, /action: 'connection-timeout'/,'technical timeout uses server-side resolver');
assert.match(manager, /mp_restartgame 1/,'AWP server restarts empty round after rules are applied');
assert.match(manager, /mp_t_default_primary weapon_awp/,'AWP mode sets deterministic default primary');
console.log('Live UI polling, Steam launch and AWP enforcement checks passed.');
