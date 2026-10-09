import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const files = [
  "lib/admin-auth.ts",
  "app/api/admin/auth/login/route.ts",
  "app/api/admin/auth/setup/route.ts",
  "app/api/admin/access/route.ts",
  "lib/platform-version.ts",
  "components/Common/LivePlatformSync.tsx",
  "app/admin/access/page.tsx",
  "app/admin/login/page.tsx",
  "app/admin/setup/page.tsx",
];
for (const file of files) assert.equal(existsSync(file), true, `${file} must exist`);
const adminLib = readFileSync("lib/admin-auth.ts", "utf8");
const login = readFileSync("app/api/admin/auth/login/route.ts", "utf8");
const setup = readFileSync("app/api/admin/auth/setup/route.ts", "utf8");
const access = readFileSync("app/api/admin/access/route.ts", "utf8");
const accessPage = readFileSync("app/admin/access/page.tsx", "utf8");
const role = readFileSync("app/api/admin/route.ts", "utf8");
const logout = readFileSync("app/api/auth/logout/route.ts", "utf8");
const setupPage = readFileSync("app/admin/setup/page.tsx", "utf8");
const versionSource = readFileSync("lib/platform-version.ts", "utf8");
const syncSource = readFileSync("components/Common/LivePlatformSync.tsx", "utf8");
assert.match(adminLib, /DUELPLAY_ADMIN_AUTH_SECRET/);
assert.match(adminLib, /ADMIN_AUTH_COOKIE/);
assert.match(adminLib, /timingSafeEqual/);
assert.match(login, /verifyPassword/);
assert.match(login, /ADMIN_LOGIN/);
assert.match(login, /createAdminAuthValue/);
assert.match(setup, /ADMIN_INVITE_PREFIX/);
assert.match(setup, /hashPassword/);
assert.match(setup, /isRevoked: true/);
assert.match(access, /newAdminInviteToken/);
assert.match(access, /ADMIN_INVITE_PREFIX/);
assert.match(access, /adminInviteUrl/);
assert.match(access, /adminRoleAssignment\.deleteMany/);
assert.match(access, /ipAddress: "ADMIN_INVITE"/);
assert.match(access, /data: \{ role: "USER" \}/);
assert.match(access, /roleCode === "FOUNDER".*не назначается/i);
assert.match(accessPage, /Ссылка для создания пароля/);
assert.match(accessPage, /navigator\.clipboard\.writeText/);
assert.match(setupPage, /Доступные действия определяются назначенной ролью/);
assert.match(role, /issueAdminInvite/);
assert.match(role, /adminInviteUrl/);
assert.match(role, /passwordHash:needsInvite\?null/);
assert.match(adminLib, /createAdminInviteUrl/);
assert.match(adminLib, /https:\/\/duelplaygame\.com/);
assert.match(access, /createAdminInviteUrl/);
assert.match(role, /createAdminInviteUrl/);
assert.match(versionSource, /BUILD_ID/);
assert.doesNotMatch(versionSource, /auditLog\.findFirst/);
assert.match(syncSource, /updateAvailable/);
assert.match(syncSource, /onClick=\{\(\) => window\.location\.reload\(\)\}/);
assert.match(logout, /ADMIN_AUTH_COOKIE/);
assert.match(logout, /path: \"\/\"/);
console.log("admin auth flow static test: PASS");
