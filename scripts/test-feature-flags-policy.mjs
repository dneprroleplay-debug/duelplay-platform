import fs from 'node:fs';
import assert from 'node:assert/strict';
const base = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const policy=fs.readFileSync(`${base}/lib/feature-flags.ts`,'utf8');
const route=fs.readFileSync(`${base}/app/api/feature-flags/route.ts`,'utf8');
const admin=fs.readFileSync(`${base}/app/api/admin/route.ts`,'utf8');
const platform=fs.readFileSync(`${base}/lib/platform-settings.ts`,'utf8');
for (const key of ['DUELS','MATCHMAKING','CASES','TOURNAMENTS','DUELPASS','PRIME','REFERRALS','PROMOS','STEAM_TRADE','MAINTENANCE_MODE']) assert.match(policy,new RegExp(`"${key}"`));
assert.match(policy,/typeof b\.enabled !== "boolean"/);
assert.match(policy,/INVALID_FEATURE_FLAG/);
assert.match(route,/requireAdmin\(5\)/);
assert.match(route,/FEATURE_FLAG_DEFAULTS/);
assert.match(route,/validateFeatureFlagPayload/);
assert.match(admin,/validateFeatureFlagPayload\(body\)/);
assert.match(platform,/from "@\/lib\/feature-flags"/);
for (const [file,key] of [['app/api/duelpass/route.ts','DUELPASS'],['app/api/prime/route.ts','PRIME'],['app/api/referrals/route.ts','REFERRALS'],['app/api/referral-race/route.ts','REFERRALS']]) {
 const t=fs.readFileSync(`${base}/${file}`,'utf8'); assert.match(t,new RegExp(`getFeatureFlag\\("${key}"`)); assert.match(t,/FEATURE_DISABLED/);
}
console.log('Feature flag policy: 18/18 PASS');
