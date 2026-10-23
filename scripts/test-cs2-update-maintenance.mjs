import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (path) => fs.readFileSync(path, 'utf8');
const updater = read('scripts/server-manager/update-all.mjs');
const timer = read('scripts/server-manager/duelplay-cs2-update.timer');
const service = read('scripts/server-manager/duelplay-cs2-update.service');

const canonical = 'csgo/addons/counterstrikesharp/plugins/DuelPlayGrenadeOnly/DuelPlayGrenadeOnly.dll';
const legacy = 'csgo/addons/counterstrikesharp/plugins/DuelPlayGrenadeOnly.dll';

const checks = [
  // The plugin moved into its named subdirectory; the updater must check the path CS2
  // actually loads, otherwise a healthy install looks "missing" and the run aborts.
  ['pre-flight checks the canonical plugin path', updater.includes(canonical)],
  ['pre-flight no longer checks the removed root-level DLL', !updater.includes(legacy)],
  ['smoke check uses the canonical plugin path', updater.includes(`['grenade plugin', '${canonical}']`)],

  // Maintenance is a window around real changes, not a trap.
  ['component verification happens before maintenance is enabled', updater.indexOf('verifyPerServerComponents();') < updater.indexOf('await setMaintenance(true);')],
  ['the previous maintenance state is captured before enabling', updater.includes('previousMaintenance = before.maintenance === true')],
  ['an interrupted previous run is detected', updater.includes("before.updateStatus?.status === 'RUNNING'")],
  ['pre-flight failures restore the previous maintenance state', updater.includes('restoreMaintenanceIfSafe(') && updater.includes('maintenanceTouched')],
  ['a mutation boundary is recorded before SteamCMD', updater.indexOf('mutationStarted = true;') > -1 && updater.indexOf('mutationStarted = true;') < updater.indexOf("await runProcess(STEAMCMD_BIN")],
  ['production plugin parity is checked before maintenance and missing files are repaired only after the mutation boundary', updater.includes('function ensurePerServerPlugins()') && updater.indexOf('verifyPerServerComponents();') < updater.indexOf('await setMaintenance(true);') && updater.indexOf('mutationStarted = true;') < updater.indexOf('ensurePerServerPlugins();')],
  ['server-changing failures keep maintenance enabled', updater.includes("mutationStarted) return false")],
  ['success disables maintenance even if status recording fails', updater.includes('Could not record success status') && updater.includes('await disableMaintenance()')],
  ['maintenance disable retries before giving up', updater.includes('async function disableMaintenance()') && updater.includes('attempt <= 3')],
  ['SIGTERM/SIGINT restore a pre-mutation window', updater.includes("process.on('SIGTERM'") && updater.includes('finishAndExit')],
  ['the successful path still disables maintenance', updater.includes('maintenance was disabled and the site returned to service')],

  // The schedule itself must stay exact and timezone-aware.
  ['timer runs daily at 05:00 Europe/Kyiv', timer.includes('OnCalendar=*-*-* 05:00:00 Europe/Kyiv')],
  ['timer catches missed runs after reboot', timer.includes('Persistent=true')],
  ['oneshot update has a bounded runtime', service.includes('Type=oneshot') && service.includes('TimeoutStartSec=90min')],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failed += 1;
}
assert.equal(failed, 0, `${failed} CS2 update maintenance check(s) failed`);
console.log(`\nCS2 update maintenance regression: PASS (${checks.length} checks)`);
