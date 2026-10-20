import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const route = read('app/api/maintenance/route.ts');
const gate = read('components/Common/MaintenanceGate.tsx');
const policy = read('lib/maintenance.ts');
const createMatch = read('app/api/matches/route.ts');
const joinMatch = read('app/api/matches/[id]/join/route.ts');
const startMatch = read('app/api/matches/[id]/start/route.ts');
const serverQueue = read('app/api/server-manager/queue/route.ts');
const serverClaim = read('app/api/server-manager/claim/route.ts');
const serverHealth = read('app/api/server-manager/health/route.ts');
const updaterMaintenance = read('app/api/server-manager/maintenance/route.ts');
const checks = [
 ['PATCH requires system.maintenance permission + MFA', route.includes('requirePermission("system.maintenance")')],
 ['PATCH rejects non-boolean enabled', route.includes('typeof (body as Record<string, unknown>).enabled !== "boolean"')],
 ['GET is no-store', route.includes('Cache-Control') && route.includes('no-store')],
 ['GET exposes admin bypass for every RBAC admin', route.includes('resolveAdminAccess(me.id)') && route.includes('access.level > 0')],
 ['audit on enable/disable', route.includes('ENABLE_MAINTENANCE') && route.includes('DISABLE_MAINTENANCE')],
 ['client gate exists', gate.includes('state?.enabled&&!state.isAdmin')],
 ['login remains accessible', gate.includes('path!=="/login"')],
 ['test-login remains accessible', gate.includes('path!=="/test-login"')],
 ['server policy reads flag', policy.includes('key: "MAINTENANCE_MODE"')],
 ['server policy bypasses every RBAC admin', policy.includes('resolveAdminAccess(me.id)') && policy.includes('access.level > 0')],
 ['maintenance uses exact CS2 update message', policy.includes('Идёт обновление серверов CS2. Пожалуйста, подождите')],
 ['match creation is backend-gated', createMatch.includes('assertMatchmakingAvailable(tx)')],
 ['match joining is backend-gated', joinMatch.includes('assertMatchmakingAvailable(tx)')],
 ['match starts are maintenance-gated and request a manager assignment', startMatch.includes('assertMatchmakingAvailable(tx)') && startMatch.includes('managerRequested: true') && startMatch.includes('startDeadlineAt: new Date(Date.now() + MATCH_SERVER_START_TIMEOUT_MS)')],
 ['queue is drained during maintenance', serverQueue.includes('maintenance.enabled') && serverQueue.includes('pending: null')],
 ['server claims reject maintenance, unready, stale or busy servers', serverClaim.includes('assertMatchmakingAvailable(tx)') && serverClaim.includes('SERVER_UNAVAILABLE') && serverClaim.includes('existing.status !== "READY"') && serverClaim.includes('lastHeartbeat: { gte: new Date(Date.now() - 30_000) }')],
 ['manager health is authenticated and timestamped', serverHealth.includes('isServerManagerRequest(request)') && serverHealth.includes('lastHeartbeat: now')],
 ['auto updater can toggle maintenance and observe active matches', updaterMaintenance.includes('activeMatches') && updaterMaintenance.includes('ENABLE_CS2_AUTO_UPDATE_MAINTENANCE')],
];
let failed=0; for(const [name,ok] of checks){console.log(`${ok?'PASS':'FAIL'} ${name}`); if(!ok) failed++;}
if(failed) process.exit(1); console.log(`Maintenance policy: ${checks.length}/${checks.length} PASS`);
