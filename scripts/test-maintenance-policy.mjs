import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(new URL('..', import.meta.url).pathname);
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const route = read('app/api/maintenance/route.ts');
const gate = read('components/Common/MaintenanceGate.tsx');
const policy = read('lib/maintenance.ts');
const checks = [
 ['PATCH requires SUPERADMIN', route.includes('me.role !== "SUPERADMIN"')],
 ['PATCH rejects non-boolean enabled', route.includes('typeof (body as Record<string, unknown>).enabled !== "boolean"')],
 ['GET is no-store', route.includes('Cache-Control') && route.includes('no-store')],
 ['GET exposes admin bypass', route.includes('hasAdminLevel(me.role, 1)')],
 ['audit on enable/disable', route.includes('ENABLE_MAINTENANCE') && route.includes('DISABLE_MAINTENANCE')],
 ['client gate exists', gate.includes('state?.enabled&&!state.isAdmin')],
 ['login remains accessible', gate.includes('path!=="/login"')],
 ['test-login remains accessible', gate.includes('path!=="/test-login"')],
 ['server policy reads flag', policy.includes('key: "MAINTENANCE_MODE"')],
 ['server policy bypasses staff', policy.includes('hasAdminLevel(me.role, 1)')],
];
let failed=0; for(const [name,ok] of checks){console.log(`${ok?'PASS':'FAIL'} ${name}`); if(!ok) failed++;}
if(failed) process.exit(1); console.log(`Maintenance policy: ${checks.length}/${checks.length} PASS`);
