import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));

assert.equal(exists("app/api/users/create/route.ts"), true);
assert.match(read("app/api/users/create/route.ts"), /status:\s*410/);

assert.match(read("lib/auth.ts"), /export function hashToken/);
assert.match(read("app/api/auth/logout/route.ts"), /token:\s*hashToken\(token\)/);
assert.match(read("app/api/auth/steam/callback/route.ts"), /token:\s*hashToken\(token\)/);

assert.match(read("app/api/server-manager/auth.ts"), /secureSecretEqual/);
assert.match(read("app/api/matches/[id]/result/route.ts"), /secureSecretEqual/);
assert.match(read("app/api/jobs/match-watchdog/route.ts"), /secureSecretEqual/);

assert.match(read("app/api/matches/[id]/result/route.ts"), /CS2_RESULT_SECRET/);
assert.match(read("app/api/payments/webhook/[provider]/route.ts"), /deposit-webhook:\$\{deposit\.id\}/);
assert.doesNotMatch(read("app/api/matches/[id]/result/route.ts"), /DUELPLAY_SERVER_MANAGER_SECRET/);

const wallet = read("lib/wallet.ts");
assert.match(wallet, /FOR UPDATE/);
assert.match(wallet, /idempotencyKey/);
for (const file of [
  "app/api/admin/route.ts",
  "app/api/disputes/route.ts",
  "app/api/matches/[id]/result/route.ts",
  "lib/match-lifecycle.ts",
]) {
  assert.doesNotMatch(read(file), /lockedBalance:\s*\{\s*(increment|decrement|set)/);
}

assert.match(read("prisma/schema.prisma"), /model AuditLog/);
assert.match(read("prisma/schema.prisma"), /requestId\s+String\?/);
assert.match(read("prisma/schema.prisma"), /result\s+String\?/);
assert.match(read("prisma/schema.prisma"), /reason\s+String\?/);
assert.match(read("prisma/migrations/20260920130000_audit_request_metadata/migration.sql"), /ADD COLUMN "requestId"/);

assert.match(read("next.config.ts"), /Strict-Transport-Security/);
assert.match(read("next.config.ts"), /X-Content-Type-Options/);
assert.match(read("next.config.ts"), /X-Frame-Options/);

assert.match(read("app/api/admin/auth/login/route.ts"), /verifyPassword/);

assert.match(read("app/api/maintenance/route.ts"), /requireAdmin\(5\)/);
assert.match(read("app/api/matches/route.ts"), /match-create:\$\{user\.id\}/);
assert.match(read("app/api/matches/[id]/join/route.ts"), /match-join:\$\{user\.id\}/);
assert.match(read("app/api/wallet/transactions/route.ts"), /wallet-withdraw:\$\{user\.id\}/);
assert.match(read("app/api/wallet/transactions/route.ts"), /wallet-deposit:\$\{user\.id\}/);
assert.match(read("app/api/duelpass/route.ts"), /duelpass:\$\{me\.id\}/);
assert.match(read("app/api/event-pass/route.ts"), /eventpass:\$\{me\.id\}/);
assert.doesNotMatch(read("app/api/profile/[nickname]/route.ts"), /betAmount:true/);
assert.doesNotMatch(read("app/api/matches/[id]/route.ts"), /host: true, port: true/);
assert.match(read("app/api/admin/auth/setup/route.ts"), /hashPassword/);
assert.match(read("app/api/admin/mfa/route.ts"), /verifyTotp/);
assert.match(wallet, /existing\.wallet\.userId!==userId/);
assert.match(read("app/api/maintenance/route.ts"), /MAINTENANCE_ACTION/);
assert.match(read("app/admin/setup/page.tsx"), /history\.replaceState/);
assert.match(read("app/api/admin/mfa/route.ts"), /requestId: auditContext\.requestId/);

assert.equal(exists("app/api/matches/[id]/local-test/route.ts.bak"), false);
assert.equal(exists("lib/progression.ts.bak"), false);

for (const [file, marker] of [
  ["app/api/matches/[id]/server/route.ts", "isServerManagerRequest"],
  ["app/api/server-manager/claim/route.ts", "isServerManagerRequest"],
  ["app/api/server-manager/queue/route.ts", "isServerManagerRequest"],
  ["app/api/jobs/match-watchdog/route.ts", "DUELPLAY_JOB_SECRET"],
]) {
  assert.match(read(file), new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${file} must retain its server-side credential gate`);
}


console.log("API/security source audit: PASS");
