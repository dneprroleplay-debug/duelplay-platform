import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const files = [
  "lib/admin-auth.ts",
  "app/api/admin/auth/login/route.ts",
  "app/api/admin/auth/setup/route.ts",
  "app/admin/login/page.tsx",
  "app/admin/setup/page.tsx",
];
for (const file of files) assert.equal(existsSync(file), true, `${file} must exist`);
const adminLib = readFileSync("lib/admin-auth.ts", "utf8");
const login = readFileSync("app/api/admin/auth/login/route.ts", "utf8");
const setup = readFileSync("app/api/admin/auth/setup/route.ts", "utf8");
const role = readFileSync("app/api/admin/route.ts", "utf8");
const logout = readFileSync("app/api/auth/logout/route.ts", "utf8");
assert.match(adminLib, /DUELPLAY_ADMIN_AUTH_SECRET/);
assert.match(adminLib, /ADMIN_AUTH_COOKIE/);
assert.match(adminLib, /timingSafeEqual/);
assert.match(login, /verifyPassword/);
assert.match(login, /ADMIN_LOGIN/);
assert.match(login, /createAdminAuthValue/);
assert.match(setup, /ADMIN_INVITE_PREFIX/);
assert.match(setup, /hashPassword/);
assert.match(setup, /isRevoked: true/);
assert.match(role, /issueAdminInvite/);
assert.match(role, /adminInviteUrl/);
assert.match(role, /passwordHash:needsInvite\?null/);
assert.match(logout, /ADMIN_AUTH_COOKIE/);
assert.match(logout, /path: \"\/\"/);
console.log("admin auth flow static test: PASS");
