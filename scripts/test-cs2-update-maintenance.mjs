import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (path) => fs.readFileSync(path, 'utf8');
const updater = read('scripts/server-manager/update-all.mjs');
const syncPolicy = read('scripts/server-manager/sync-policy.mjs');
const timer = read('scripts/server-manager/duelplay-cs2-update.timer');
const service = read('scripts/server-manager/duelplay-cs2-update.service');
const reconcileTimer = read('scripts/server-manager/duelplay-cs2-maintenance-reconcile.timer');
const reconcileService = read('scripts/server-manager/duelplay-cs2-maintenance-reconcile.service');
const finalize = read('app/api/server-manager/update-runs/finalize/route.ts');
const claim = read('app/api/server-manager/update-schedule/claim/route.ts');
const activeGate = read('app/api/server-manager/update-runs/active/route.ts');
const scheduler = read('scripts/server-manager/update-schedule-check.mjs');
const noUpdateStart = updater.indexOf("if (plan.action === 'NO_UPDATE')");
const noUpdateEnd = updater.indexOf("log(`Update decision:", noUpdateStart);
const noUpdateBlock = updater.slice(noUpdateStart, noUpdateEnd);

const canonical = 'csgo/addons/counterstrikesharp/plugins/DuelPlayGrenadeOnly/DuelPlayGrenadeOnly.dll';
const legacy = 'csgo/addons/counterstrikesharp/plugins/DuelPlayGrenadeOnly.dll';
const syncMutation = updater.slice(updater.indexOf('async function syncInstanceFromShared'), updater.indexOf('function verifyInstanceMatchesShared'));

const checks = [
  // The plugin moved into its named subdirectory; the updater must check the path CS2
  // actually loads, otherwise a healthy install looks "missing" and the run aborts.
  ['pre-flight checks the canonical plugin path', updater.includes(canonical)],
  ['pre-flight no longer checks the removed root-level DLL', !updater.includes(legacy)],
  ['smoke check uses the canonical plugin path', updater.includes(`['grenade plugin', '${canonical}']`)],

  // No-update and drift runs are read-only with respect to the game installs.
  ['same Build ID exits without scanning game directories or running rsync', noUpdateStart >= 0 && noUpdateEnd > noUpdateStart && noUpdateBlock.includes("persistAttempt('NO_UPDATE'") && !noUpdateBlock.includes('inspectInstanceDrift') && !noUpdateBlock.includes('rsyncDriftCheck')],
  ['ordinary pre-sync drift uses metadata-only rsync while explicit state adoption retains checksums', updater.includes("checksum ? '-acni' : '-ani'") && updater.includes('rsyncDriftCheck(server, { checksum: true })') && updater.includes('const preUpdateInspection = await inspectInstanceDrift();')],
  ['Steam Build claims require the enabled admin schedule under its advisory lock', claim.includes('CS2_UPDATE_SCHEDULE_LOCK') && claim.includes('!schedule.enabled') && claim.includes('readCs2UpdateSchedule(tx)')],
  ['updater rechecks schedule enablement and revision before doing work', activeGate.includes('!scheduleRead.schedule.enabled') && activeGate.includes('scheduleRead.schedule.revision !== run.scheduleRevision') && !activeGate.includes('run.source !== "STEAM_BUILD"')],
  ['safe pre-mutation FAILED Build ID claims can be retried while unsafe failures remain blocked', claim.includes('existing.status === "FAILED"') && claim.includes('existing.maintenanceEnabled === false') && claim.includes('existing.syncMarkerActive === false') && claim.includes('RETRY_REQUIRES_INTERVENTION')],
  ['scheduler and updater use the installed absolute SteamCMD path by default', scheduler.includes("|| '/usr/games/steamcmd'") && updater.includes("|| '/usr/games/steamcmd'")],
  ['NO_UPDATE logs installed and public IDs, then returns before app_update, maintenance, markers, sync, and smoke tests', updater.includes('NO_UPDATE installedBuildId=${buildIdBefore} publicBuildId=${latestBuildId}') && updater.indexOf("if (plan.action === 'NO_UPDATE')") < updater.indexOf('await setMaintenance(true);') && updater.indexOf("if (plan.action === 'NO_UPDATE')") < updater.indexOf('beginSyncMarker();') && updater.indexOf("if (plan.action === 'NO_UPDATE')") < updater.indexOf("'+app_update'") && updater.indexOf("if (plan.action === 'NO_UPDATE')") < updater.indexOf('await syncInstances({') && updater.indexOf("if (plan.action === 'NO_UPDATE')") < updater.indexOf('await smokeCheckServer(server)')],
  ['new Build ID preflight detects and blocks pre-existing instance drift without repair', updater.includes('const preUpdateInspection = await inspectInstanceDrift();') && updater.includes('logInstanceDrift(preUpdateInspection.differences, buildIdBefore, latestBuildId)') && updater.includes("persistAttempt('INSTANCE_DRIFT'") && updater.includes('UPDATE_BLOCKED_BY_INSTANCE_DRIFT')],
  ['pre-existing source conflicts block a new Build ID update before maintenance', updater.indexOf('const preUpdateInspection = await inspectInstanceDrift();') < updater.indexOf('await setMaintenance(true);') && updater.includes('preExistingConflicts.length') && updater.includes('Pre-existing source/instance drift requires review before updating.')],
  ['missing Build IDs cannot trigger recovery downloads', updater.includes("plan.action === 'BLOCKED'") && updater.includes('refusing to update or synchronize any files')],
  ['SteamCMD app_update is invoked at exactly one call site', (updater.match(/\+app_update/g) ?? []).length === 1],
  ['an update uses checksum-based rsync and never deletes destination files', syncMutation.includes("...(deep ? ['--checksum'] : [])") && !syncMutation.includes('--delete')],
  ['drift inventory is checksum-based and read-only, including target-only paths', updater.includes("'-acni'") && updater.includes("'--delete'") && updater.includes('paired with -n only')],
  ['per-instance configs, workshop maps and add-ons are excluded from mutation sync', ['--exclude=/csgo/addons', '--exclude=/csgo/cfg', '--exclude=/csgo/maps/workshop', '--exclude=/bin/linuxsteamrt64/steamapps', '--exclude=/csgo/gameinfo.gi'].every(value => syncPolicy.includes(value)) && updater.includes('...SYNC_EXCLUDES')],
  ['protected plugins are only parity-checked, never copied or repaired', updater.includes('findProductionPluginDrift()') && !updater.includes('function ensurePerServerPlugins()') && !updater.includes('function copyFromWorkingServer(')],
  ['component verification happens before maintenance is enabled', updater.indexOf('verifyPerServerComponents();') < updater.indexOf('await setMaintenance(true);')],
  ['active matches/processes are rejected before any server mutation', updater.indexOf('await assertInstancesIdle();') < updater.indexOf('mutationStarted = true;') && updater.indexOf('mutationStarted = true;') < updater.indexOf('await runProcess(STEAMCMD_BIN')],
  ['a stale RUNNING status is marked interrupted by the lock-owning updater', updater.includes("previousStatus === 'RUNNING'") && updater.includes('treating it as interrupted') && updater.includes('INTERRUPTED_UPDATER_STATE')],
  ['finalization is retried before an update is declared failed', updater.includes('async function finalizeUpdateRun(') && updater.includes('attempt <= 3') && updater.includes('await finalizeUpdateRun(finalStatus)')],
  ['SteamCMD is bounded by a timeout', updater.includes('STEAMCMD_TIMEOUT_MS') && updater.includes('timeoutMs: STEAMCMD_TIMEOUT_MS')],
  ['pre-mutation failures restore the previous maintenance state', updater.includes('restoreMaintenanceIfSafe(') && updater.includes('maintenanceTouched')],
  ['server-changing failures keep maintenance enabled and the sync marker', updater.includes('mutationStarted) return false') && updater.includes('sync marker stay in place')],
  ['a smoke process must exit cleanly and have no crash output before update success is recorded', updater.includes('classifySmokeProcessExit(') && updater.includes('readinessChecksPassed = true;')],
  ['maintenance is released only by the finalize endpoint after verification', finalize.includes('featureFlag.update') && finalize.includes('enabled: false') && finalize.includes('allInstancesVerified')],
  ['SIGTERM/SIGINT restore a pre-mutation window', updater.includes("process.on('SIGTERM'") && updater.includes('finishAndExit')],
  ['successful build state is persisted atomically', updater.includes('function persistUpdateState(state)') && updater.includes('renameSync(tempPath, STATE_FILE)') && updater.includes('createSuccessfulState(buildIdAfter, sharedBuildAfter')],

  // The schedule itself must stay exact and timezone-aware.
  ['timer polls every minute and delegates due-time decisions to the VPS poller', timer.includes('OnCalendar=*-*-* *:*:00 Europe/Kyiv') && timer.includes('Unit=duelplay-cs2-update-scheduler.service')],
  ['timer does not catch up missed runs after reboot', timer.includes('Persistent=false')],
  ['oneshot update has a bounded runtime', service.includes('Type=oneshot') && service.includes('TimeoutStartSec=90min')],
  ['update service reconciles stale maintenance on exit', service.includes('ExecStopPost=') && service.includes('reconcile-cs2-maintenance.mjs --auto')],
  ['maintenance reconcile timer is periodic and runs after boot', reconcileTimer.includes('OnCalendar=*:0/10 Europe/Kyiv') && reconcileTimer.includes('OnBootSec=3min')],
  ['maintenance reconcile service is a bounded oneshot', reconcileService.includes('Type=oneshot') && reconcileService.includes('reconcile-cs2-maintenance.mjs --auto') && reconcileService.includes('TimeoutStartSec=5min')],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failed += 1;
}
assert.equal(failed, 0, `${failed} CS2 update maintenance check(s) failed`);
console.log(`\nCS2 update maintenance regression: PASS (${checks.length} checks)`);
