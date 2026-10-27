import fs from 'node:fs';
import assert from 'node:assert/strict';

const api = fs.readFileSync('app/api/admin/access/route.ts', 'utf8');
const page = fs.readFileSync('app/admin/access/page.tsx', 'utf8');
const checks = [];
function check(name, fn) { fn(); checks.push(name); }

check('email fields are selected from Prisma on the server', () => {
  assert.match(api, /email:\s*true/);
  assert.match(api, /emailVerifiedAt:\s*true/);
  assert.match(api, /prisma\.user\.findMany\([\s\S]*?select:\s*\{[\s\S]*?email:\s*true[\s\S]*?emailVerifiedAt:\s*true/);
});
check('email exposure is restricted to FOUNDER level 999', () => {
  assert.match(api, /access\.roleCode\s*===\s*"FOUNDER"\s*&&\s*access\.level\s*===\s*999/);
  assert.match(api, /canViewSensitiveUserEmail\s*\?\s*user\s*:/);
  assert.match(api, /requireAdminAccess\(\)/);
});
check('existing roles/assignments permissions remain unchanged', () => {
  assert.match(api, /requirePermission|hasPermission/);
  assert.match(api, /assignments:\s*access\.roleCode\s*===\s*"FOUNDER"\s*\|\|\s*hasPermission/);
});
check('Email column shows address or Не привязан', () => {
  assert.match(page, /<th[^>]*>Email<\/th>/);
  assert.match(page, /u\.email\s*\|\|\s*"Не привязан"/);
});
check('confirmed email status uses emailVerifiedAt', () => {
  assert.match(page, /u\.emailVerifiedAt\s*\?\s*"Подтверждён"\s*:\s*hasEmail\s*\?\s*"Не подтверждён"\s*:\s*"Нет email"/);
});
check('unconfirmed email status appears when email exists without verification timestamp', () => {
  assert.match(page, /hasEmail\s*\?\s*"Не подтверждён"/);
});
check('missing email status appears when email is absent', () => {
  assert.match(page, /:\s*"Нет email"/);
});
check('Steam status and account deletion action are preserved', () => {
  assert.match(page, /u\.steamId\s*\?\s*"Привязан"\s*:\s*"—"/);
  assert.match(page, /Удалить аккаунт навсегда/);
  assert.match(page, /disabled=\{busy\|\|u\.id===data\.me\.id\}/);
});
check('long emails wrap and table scrolls on narrow screens', () => {
  assert.match(page, /overflow-x-auto/);
  assert.match(page, /break-all text-xs text-zinc-300/);
  assert.match(page, /min-w-\[1180px\]/);
});

console.log(`Admin access user email checks: PASS (${checks.length} assertions)`);
for (const name of checks) console.log(`  ✓ ${name}`);
