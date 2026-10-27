import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isAllowedPublicOrigin } from '../lib/security/public-origin.mjs';

const productionEnv = {
  NODE_ENV: 'production',
  DUELPLAY_API_URL: 'https://duelplaygame.com',
  NEXT_PUBLIC_SITE_URL: 'https://duelplaygame.com/',
};
let checks = 0;
function check(value, message) { assert.equal(value, true, message); checks += 1; }
function reject(value, message) { assert.equal(value, false, message); checks += 1; }

check(isAllowedPublicOrigin('https://duelplaygame.com', productionEnv), 'production canonical origin is accepted');
reject(isAllowedPublicOrigin('https://attacker.example', productionEnv), 'unrelated domain is rejected');
reject(isAllowedPublicOrigin(null, productionEnv), 'missing Origin is rejected');
reject(isAllowedPublicOrigin('null', productionEnv), 'opaque null Origin is rejected');
reject(isAllowedPublicOrigin('https://duelplaygame.com/path', productionEnv), 'Origin containing a path is rejected');
reject(isAllowedPublicOrigin('https://duelplaygame.com/', productionEnv), 'Origin with trailing slash is rejected as malformed serialization');
reject(isAllowedPublicOrigin('http://duelplaygame.com', productionEnv), 'wrong scheme is rejected');
reject(isAllowedPublicOrigin('https://duelplaygame.com.evil.example', productionEnv), 'lookalike domain is rejected');
check(isAllowedPublicOrigin('https://duelplaygame.com', productionEnv, 'http://duelplay-web:3000/api/admin/access/permanent-delete'), 'public Origin remains valid when request URL is an internal Coolify origin');
reject(isAllowedPublicOrigin('http://duelplay-web:3000', productionEnv, 'http://duelplay-web:3000/api/admin/access/permanent-delete'), 'internal container origin is not accepted as browser Origin');
reject(isAllowedPublicOrigin('https://duelplaygame.com', { NODE_ENV: 'production', DUELPLAY_API_URL: 'not-a-url' }), 'invalid explicitly configured canonical URL fails closed');

const route = readFileSync(new URL('../app/api/admin/access/permanent-delete/route.ts', import.meta.url), 'utf8');
assert.match(route, /access\.roleCode !== "FOUNDER" \|\| access\.level !== 999/, 'Founder level 999 guard remains'); checks++;
assert.match(route, /requireAdminAccess\(\)/, 'MFA/admin session guard remains'); checks++;
assert.match(route, /CSRF_ORIGIN_REJECTED/, 'CSRF rejection remains'); checks++;
assert.doesNotMatch(route, /headers\.get\(["']x-forwarded-host["']\)|headers\.get\(["']host["']\)/, 'route does not trust client-supplied Host or X-Forwarded-Host'); checks++;

console.log(`Permanent-delete public-origin checks: PASS (${checks} assertions).`);
