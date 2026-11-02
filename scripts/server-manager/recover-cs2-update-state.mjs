#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUpdateScheduleClient } from './update-schedule-client.mjs';
import { runControlledCs2Recovery, cs2RecoveryIdForRun } from '../../lib/cs2-update-recovery.mjs';
import { createMarkerAdapter } from '../../lib/cs2-update-recovery-marker.mjs';
import { enterFlockOrRelaunch } from '../../lib/cs2-update-recovery-lock.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '../..');
const COMMON_DIR = process.env.CS2_STEAMCMD_DIR || '/home/ubuntu/cs2';
const LOCK_PATH = path.join(COMMON_DIR, '.duelplay-cs2-controlled-recovery.lock');

let lockLaunch;
try {
  lockLaunch = enterFlockOrRelaunch({ lockPath: LOCK_PATH, scriptPath: fileURLToPath(import.meta.url) });
} catch (error) {
  console.error(`CS2 controlled recovery lock refused: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
if (!lockLaunch.isChild) {
  if (lockLaunch.error) console.error(lockLaunch.error);
  process.exit(lockLaunch.exitCode);
}

const argv = lockLaunch.args;
const CONFIG_DIR = process.env.DUELPLAY_MANAGER_CONFIG_DIR || path.join(PROJECT_ROOT, 'scripts/server-manager');
const CONFIG = readEnv(path.join(CONFIG_DIR, '.env'));
const API_URL = String(process.env.DUELPLAY_API_URL || CONFIG.DUELPLAY_API_URL || '').replace(/\/$/, '');
const SECRET = process.env.DUELPLAY_SERVER_MANAGER_SECRET || CONFIG.DUELPLAY_SERVER_MANAGER_SECRET || '';
const MARKER_PATH = process.env.DUELPLAY_CS2_SYNC_MARKER || path.join(COMMON_DIR, '.duelplay-sync-in-progress');
const runIdIndex = argv.indexOf('--run-id');
const runId = runIdIndex >= 0 ? argv[runIdIndex + 1] : '';
const confirmed = argv.includes('--confirm');

function readEnv(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`RECOVERY_CONFIG_MISSING: ${filePath}`);
  const values = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

function pidIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ESRCH') return false;
    // EPERM means the PID exists but is not signalable; fail closed.
    return true;
  }
}

function assertNoConflictingProcesses() {
  // pgrep is read-only and avoids assuming this service account can read every
  // other user's /proc/<pid>/cmdline. Any unavailable/error result fails closed.
  const checks = [
    { label: 'update-all.mjs', args: ['-af', 'update-all[.]mjs'] },
    { label: 'SteamCMD', args: ['-af', 'steamcmd([.]sh|_linux)?([[:space:]]|$)'] },
    { label: 'cs2', args: ['-x', 'cs2'] },
    { label: 'cs2_linux64', args: ['-x', 'cs2_linux64'] },
    { label: 'srcds_linux', args: ['-x', 'srcds_linux'] },
    { label: 'cs2.sh launcher', args: ['-af', 'cs2[.]sh'] },
  ];
  const conflicts = [];
  for (const check of checks) {
    const result = spawnSync('pgrep', check.args, { encoding: 'utf8' });
    if (result.error) throw new Error(`PROCESS_CHECK_FAILED ${check.label}: ${result.error.message}`);
    if (result.status === 0) {
      const lines = String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean);
      conflicts.push({ label: check.label, processes: lines.map(line => line.slice(0, 240)) });
    } else if (result.status !== 1) {
      throw new Error(`PROCESS_CHECK_FAILED ${check.label}: exit=${result.status}`);
    }
  }
  if (conflicts.length) throw new Error(`CONFLICTING_PROCESS_ACTIVE ${JSON.stringify(conflicts)}`);
}

function showUsage() {
  console.log('Controlled CS2 updater state recovery (no updater, SteamCMD, or game process is launched).');
  console.log('Usage: node scripts/server-manager/recover-cs2-update-state.mjs --run-id <FAILED_RUN_UUID> --confirm');
  console.log('The command requires a deployed /api/server-manager/update-recovery endpoint and existing server-manager .env.');
}

async function main() {
  if (!runId || !confirmed) {
    showUsage();
    process.exitCode = 2;
    return;
  }
  if (!API_URL) throw new Error('DUELPLAY_API_URL is required');
  if (typeof SECRET !== 'string' || SECRET.length < 32) throw new Error('DUELPLAY_SERVER_MANAGER_SECRET is required');
  const normalizedRunId = runId.toLowerCase();
  const recoveryId = cs2RecoveryIdForRun(normalizedRunId);
  const request = createUpdateScheduleClient({ apiUrl: API_URL, secret: SECRET });
  const api = {
    async inspect(id) {
      const [snapshot, run, recovery] = await Promise.all([
        request('/api/server-manager/maintenance'),
        request(`/api/server-manager/update-runs?runId=${encodeURIComponent(id)}`),
        request(`/api/server-manager/update-recovery?runId=${encodeURIComponent(id)}`),
      ]);
      return { snapshot, run, ledger: recovery.ledger ?? null, phase: recovery.phase ?? 'NOT_STARTED' };
    },
    async action(action, payload) {
      return request('/api/server-manager/update-recovery', {
        method: 'POST', body: { action, ...payload },
      });
    },
  };
  const marker = createMarkerAdapter(MARKER_PATH);
  console.log(`Starting controlled recovery for FAILED run ${normalizedRunId}; recoveryId=${recoveryId}`);
  console.log('Maintenance must remain enabled for the entire operation.');
  const result = await runControlledCs2Recovery({
    runId: normalizedRunId,
    api,
    marker,
    pidIsAlive,
    assertNoConflictingProcesses,
    confirm: true,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(`CS2 controlled recovery stopped safely: ${error instanceof Error ? error.message : String(error)}`);
  console.error('No command launches SteamCMD or a game process. Maintenance is not disabled by this script.');
  process.exitCode = 1;
});
