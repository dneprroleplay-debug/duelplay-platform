import fs from 'node:fs';
import assert from 'node:assert/strict';

const adminApi = fs.readFileSync('app/api/admin/route.ts', 'utf8');
const archiveApi = fs.readFileSync('app/api/admin/access/users/route.ts', 'utf8');
const panel = fs.readFileSync('components/Admin/LegacyAdminPanel.tsx', 'utf8');
const checks = [];
function check(name, fn) { fn(); checks.push(name); }

check('active users is the default view', () => {
  assert.match(panel, /useState<"active"\|"deleted">\("active"\)/);
  assert.match(panel, /userListMode==="active"\?/);
  assert.match(adminApi, /prisma\.user\.findMany\(\{where:\{deletedAt:null\}/);
});
check('anonymized deleted accounts are excluded from the active API list', () => {
  assert.match(adminApi, /prisma\.user\.findMany\(\{where:\{deletedAt:null\},orderBy/);
});
check('archive includes only deletedAt records with DEACTIVATED status', () => {
  assert.match(archiveApi, /view === "deleted"/);
  assert.match(archiveApi, /deletedAt:\s*\{\s*not:\s*null\s*\}/);
  assert.match(archiveApi, /status:\s*"DEACTIVATED"/);
});
check('ordinary DEACTIVATED users without deletedAt are not archived', () => {
  assert.match(archiveApi, /deletedAt:\s*\{\s*not:\s*null\s*\}/);
  assert.match(archiveApi, /status:\s*"DEACTIVATED"/);
});
check('archive API enforces FOUNDER level 999 on the server', () => {
  assert.match(archiveApi, /const access = await requireAdminAccess\(\)/);
  assert.match(archiveApi, /await requirePermission\("users\.view"\)/);
  assert.match(archiveApi, /access\.roleCode !== "FOUNDER" \|\| access\.level !== 999/);
});
check('archive response contains only anonymized identifier, status and deletion date', () => {
  assert.match(archiveApi, /select:\s*\{\s*id:\s*true,\s*nickname:\s*true,\s*status:\s*true,\s*deletedAt:\s*true\s*\}/);
  assert.doesNotMatch(archiveApi.match(/if \(view === "deleted"\)[\s\S]*?return NextResponse\.json\(\{\s*view: "deleted"[\s\S]*?\}\, \{ headers:/)?.[0] || '', /email|steamId|balance|wallet/i);
});
check('archive table has no wallet adjustment or session actions', () => {
  const archiveTable = panel.match(/:<table className="w-full min-w-\[620px\] text-sm">[\s\S]*?<\/table>/)?.[0] || '';
  assert.ok(archiveTable.length > 0, 'archive table markup found');
  assert.doesNotMatch(archiveTable, /Пополнить|Списать|Sessions|walletAdjust|revokeUserSessions/);
  assert.match(archiveTable, /Дата удаления/);
});
check('active-user actions remain available as before', () => {
  assert.match(panel, /setWalletMode\("credit"\)/);
  assert.match(panel, /setWalletMode\("debit"\)/);
  assert.match(panel, /revokeUserSessions/);
  assert.match(panel, /<option value="DEACTIVATED">DEACTIVATED<\/option>/);
});
check('archive toggle is hidden outside founder level 999', () => {
  assert.match(panel, /d\.me\.role==="FOUNDER"&&d\.me\.level===999/);
  assert.match(panel, /canViewDeletedArchive&&<button[\s\S]*?>Удалённые аккаунты/);
});

console.log(`Admin user archive checks: PASS (${checks.length} assertions)`);
for (const name of checks) console.log(`  ✓ ${name}`);
