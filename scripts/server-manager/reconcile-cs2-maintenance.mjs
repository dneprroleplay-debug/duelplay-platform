#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadInstanceRegistry } from './instance-registry.mjs';
import { CONTROL_FILES } from './sync-policy.mjs';
import { createUpdateScheduleClient } from './update-schedule-client.mjs';
import { enterFlockOrRelaunch } from '../../lib/cs2-update-recovery-lock.mjs';
import { isLegacyCs2UpdaterMarkerContent } from '../../lib/cs2-update-recovery.mjs';
import {
  REQUIRED_CS2_SERVERS,
  clusterIsIdleAndHealthy,
  decideStaleMaintenanceRelease,
} from '../../lib/cs2-maintenance-reconcile.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '../..');
const COMMON_DIR = process.env.CS2_STEAMCMD_DIR || '/home/ubuntu/cs2';
const GAME_DIR = path.join(COMMON_DIR, 'game');
const CONFIG_DIR = process.env.DUELPLAY_MANAGER_CONFIG_DIR || path.join(PROJECT_ROOT, 'scripts/server-manager');
const UPDATE_LOCK_PATH = path.join(COMMON_DIR, '.duelplay-cs2-update.lock');
const MARKER_PATH = process.env.DUELPLAY_CS2_SYNC_MARKER || path.join(COMMON_DIR, '.duelplay-sync-in-progress');
const MARKER_MIN_AGE_MS = 60_000;

let lockLaunch;
try {
  lockLaunch = enterFlockOrRelaunch({ lockPath: UPDATE_LOCK_PATH, scriptPath: fileURLToPath(import.meta.url) });
} catch (error) {
  console.error(`[DuelPlay CS2 reconcile] lock refused: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
if (!lockLaunch.isChild) {
  if (lockLaunch.error) console.error(`[DuelPlay CS2 reconcile] ${lockLaunch.error}`);
  process.exit(lockLaunch.exitCode === 75 ? 75 : lockLaunch.exitCode);
}

const argv = lockLaunch.args;
const auto = argv.includes('--auto');
const dryRun = argv.includes('--dry-run');
const force = argv.includes('--force');

function log(message) {
  console.log(`${new Date().toISOString()} [DuelPlay CS2 reconcile] ${message}`);
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Missing updater environment file: ${filePath}`);
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

function serializeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function pidIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ESRCH') return false;
    return true;
  }
}

function updaterServiceIsActive() {
  const result = spawnSync('/usr/bin/systemctl', ['is-active', '--quiet', 'duelplay-cs2-update.service'], { encoding: 'utf8' });
  if (result.error) throw new Error(`Could not query updater service: ${result.error.message}`);
  if (result.status === 0) return true;
  if (result.status === 3) return false;
  throw new Error(`Updater service state is unknown (systemctl exit=${result.status ?? 'null'}).`);
}

function conflictingProcesses() {
  const checks = [
    ['update-all.mjs', ['-af', 'update-all[.]mjs']],
    ['SteamCMD', ['-af', 'steamcmd([.]sh|_linux)?([[:space:]]|$)']],
    ['cs2', ['-x', 'cs2']],
    ['cs2_linux64', ['-x', 'cs2_linux64']],
    ['srcds_linux', ['-x', 'srcds_linux']],
  ];
  const found = [];
  for (const [label, args] of checks) {
    const result = spawnSync('pgrep', args, { encoding: 'utf8' });
    if (result.error) throw new Error(`Process check failed (${label}): ${result.error.message}`);
    if (result.status === 0) {
      found.push({ label, processes: String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean).map(line => line.slice(0, 240)) });
    } else if (result.status !== 1) {
      throw new Error(`Process check failed (${label}): pgrep exit=${result.status}`);
    }
  }
  return found;
}

function hashFile(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readServerVersion(root) {
  try {
    const match = fs.readFileSync(path.join(root, 'csgo', 'steam.inf'), 'utf8').match(/^ServerVersion=(.+)$/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

function readSharedBuildId() {
  try {
    const match = fs.readFileSync(path.join(COMMON_DIR, 'steamapps', 'appmanifest_730.acf'), 'utf8').match(/"buildid"\s+"(\d+)"/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function verifyClusterFiles() {
  const servers = loadInstanceRegistry(CONFIG_DIR);
  if (servers.map(server => server.name).join(',') !== REQUIRED_CS2_SERVERS.join(',')) {
    throw new Error(`Unexpected instance registry: ${servers.map(server => server.name).join(',') || 'none'}`);
  }
  const sharedVersion = readServerVersion(GAME_DIR);
  if (!sharedVersion) throw new Error('Shared CS2 ServerVersion is unavailable.');
  const sharedHashes = Object.fromEntries(CONTROL_FILES.map(relativePath => [relativePath, hashFile(path.join(GAME_DIR, relativePath))]));
  for (const server of servers) {
    const version = readServerVersion(server.root);
    if (version !== sharedVersion) throw new Error(`${server.name}: ServerVersion ${version ?? 'unknown'} does not match shared ${sharedVersion}.`);
    for (const relativePath of CONTROL_FILES) {
      const actual = hashFile(path.join(server.root, relativePath));
      if (actual !== sharedHashes[relativePath]) throw new Error(`${server.name}: ${relativePath} does not match the shared installation.`);
    }
  }
  return { servers, sharedVersion, buildId: readSharedBuildId() };
}

function removeStalePayloadMarker() {
  let stats;
  try {
    stats = fs.lstatSync(MARKER_PATH);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return 'ABSENT';
    throw error;
  }
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('SYNC_MARKER_NOT_A_REGULAR_FILE');
  let content;
  try {
    content = JSON.parse(fs.readFileSync(MARKER_PATH, 'utf8'));
  } catch {
    throw new Error('SYNC_MARKER_UNREADABLE');
  }
  if (!isLegacyCs2UpdaterMarkerContent(content)) {
    throw new Error('SYNC_MARKER_NOT_OWNED_BY_LEGACY_UPDATER');
  }
  if (pidIsAlive(content.pid)) throw new Error(`SYNC_MARKER_PID_STILL_ALIVE pid=${content.pid}`);
  const ageMs = Date.now() - stats.mtimeMs;
  if (!Number.isFinite(ageMs) || ageMs < MARKER_MIN_AGE_MS) throw new Error('SYNC_MARKER_TOO_RECENT');
  fs.unlinkSync(MARKER_PATH);
  return 'REMOVED';
}

async function main() {
  const sharedEnv = readEnvFile(path.join(CONFIG_DIR, '.env'));
  const apiUrl = process.env.DUELPLAY_API_URL || sharedEnv.DUELPLAY_API_URL || '';
  const secret = process.env.DUELPLAY_SERVER_MANAGER_SECRET || sharedEnv.DUELPLAY_SERVER_MANAGER_SECRET || '';
  const api = createUpdateScheduleClient({ apiUrl, secret });

  if (updaterServiceIsActive()) {
    log('Updater service is active; reconciliation skipped.');
    return { ok: true, released: false, reason: 'UPDATER_ACTIVE' };
  }
  const conflicts = conflictingProcesses();
  if (conflicts.length) {
    log(`Conflicting CS2/updater processes are active; reconciliation skipped: ${JSON.stringify(conflicts)}`);
    return { ok: true, released: false, reason: 'CONFLICTING_PROCESS_ACTIVE' };
  }

  const snapshot = await api('/api/server-manager/maintenance');
  const decision = decideStaleMaintenanceRelease(snapshot, { force });
  log(`Decision: release=${decision.release} reason=${decision.reason} maintenance=${snapshot?.maintenance === true} status=${snapshot?.updateStatus?.status ?? 'unknown'}`);
  if (!decision.release) {
    return { ok: true, released: false, reason: decision.reason };
  }
  if (!clusterIsIdleAndHealthy(snapshot)) {
    log('Cluster is not idle and healthy; refusing to release maintenance.');
    return { ok: true, released: false, reason: 'CLUSTER_NOT_IDLE_AND_HEALTHY' };
  }

  const verification = verifyClusterFiles();
  log(`File verification passed: buildId=${verification.buildId ?? 'unknown'} serverVersion=${verification.sharedVersion} instances=${verification.servers.map(server => server.name).join(',')}`);

  const marker = removeStalePayloadMarker();
  log(`Stale sync marker: ${marker}`);

  if (dryRun) {
    log('Dry run: maintenance would be disabled now.');
    return { ok: true, released: false, dryRun: true, reason: decision.reason, marker };
  }

  await api('/api/server-manager/maintenance', { method: 'POST', body: { enabled: false } });
  log(`Maintenance disabled after verified ${decision.reason}; no game files or game processes were changed.`);
  return { ok: true, released: true, reason: decision.reason, marker, buildId: verification.buildId, serverVersion: verification.sharedVersion };
}

try {
  const result = await main();
  log(`Result: ${JSON.stringify(result)}`);
} catch (error) {
  log(`FAILED: ${serializeError(error)}`);
  if (!auto) process.exitCode = 1;
}
