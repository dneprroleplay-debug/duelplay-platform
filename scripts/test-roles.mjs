import fs from 'node:fs';
import path from 'node:path';

const policy = fs.readFileSync('lib/role-policy.ts','utf8');
const admin = fs.readFileSync('lib/admin.ts','utf8');
const reports = fs.readFileSync('app/api/reports/route.ts','utf8');
const disputes = fs.readFileSync('app/api/disputes/route.ts','utf8');
const support = fs.readFileSync('app/api/support/route.ts','utf8');
const maintenance = fs.readFileSync('app/api/maintenance/route.ts','utf8');

const checks = [
  ['role catalog is server-defined', policy.includes('USER') && policy.includes('SUPERADMIN')],
  ['admin levels are server-defined', admin.includes('ADMIN_LEVELS') && admin.includes('requireAdmin')],
  ['SUPERADMIN cannot be forged by arbitrary role string', policy.includes('actorRole !== "SUPERADMIN"')],
  ['reports use centralized RBAC review permission', reports.includes('requirePermission("risk.cases.review")')],
  ['disputes use centralized RBAC resolve permission', disputes.includes('requirePermission("disputes.resolve")')],
  ['support uses centralized staff policy', support.includes('isStaffRole(user.role)')],
  ['maintenance derives admin state from RBAC access', maintenance.includes('resolveAdminAccess(me.id)') && maintenance.includes('access.level > 0')],
  ['admin mutation routes use requireAdmin', fs.readdirSync('app/api/admin').length > 0],
];
let failed=0;
for (const [name,ok] of checks) { console.log(`${ok?'PASS':'FAIL'} ${name}`); if(!ok) failed++; }
if(failed) process.exit(1);
console.log(`Roles policy: ${checks.length}/${checks.length} PASS`);
