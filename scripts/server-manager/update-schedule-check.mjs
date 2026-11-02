import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUpdateScheduleClient } from './update-schedule-client.mjs';
import { parseSteamPublicBuildId } from './sync-policy.mjs';

const CONFIG_DIR = process.env.DUELPLAY_MANAGER_CONFIG_DIR || '/home/ubuntu/duelplay-app/scripts/server-manager';
const RUN_ENV_FILE = process.env.DUELPLAY_CS2_UPDATE_RUN_ENV_FILE || '/run/duelplay-cs2-update-scheduler/run.env';
const RECONCILE_SCRIPT = `${dirname(fileURLToPath(import.meta.url))}/reconcile-cs2-maintenance.mjs`;
const COMMON_DIR = process.env.CS2_STEAMCMD_DIR || '/home/ubuntu/cs2';
const STEAMCMD_BIN = process.env.STEAMCMD_BIN || '/usr/games/steamcmd';
const APP_ID = process.env.CS2_APP_ID || '730';

function readEnvFile(filePath) {
  if (!existsSync(filePath)) throw new Error(`Missing updater environment file: ${filePath}`);
  const values = {};
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

function childExit(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ exitCode: code, signal }));
  });
}

async function reconcileStaleMaintenance() {
  // Recovery must never block the appointment itself. The reconciler holds the
  // same flock as update-all and refuses to act while an updater is running.
  try {
    const result = await childExit(process.execPath, [RECONCILE_SCRIPT, '--auto']);
    if (result.exitCode !== 0) console.error(`[DuelPlay CS2 scheduler] maintenance reconcile exit=${result.exitCode ?? 'null'} signal=${result.signal ?? 'none'}`);
  } catch (error) {
    console.error(`[DuelPlay CS2 scheduler] maintenance reconcile failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}


function querySteamPublicBuildId() {
  return new Promise((resolve, reject) => {
    const child = spawn(STEAMCMD_BIN, ['+login', 'anonymous', '+app_info_update', '1', '+app_info_print', APP_ID, '+quit'], {
      cwd: COMMON_DIR, env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let settled = false;
    const finish = (error, value = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const append = chunk => { output += chunk.toString(); if (output.length > 4_000_000) output = output.slice(-4_000_000); };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.once('error', error => finish(error));
    child.once('close', (code, signal) => {
      if (code !== 0) return finish(new Error(`Steam metadata query failed (exit=${code ?? 'null'}, signal=${signal ?? 'none'}).`));
      const buildId = parseSteamPublicBuildId(output);
      if (!buildId) return finish(new Error('Steam public branch Build ID was not found in SteamCMD metadata.'));
      finish(null, buildId);
    });
    const timer = setTimeout(() => { child.kill('SIGTERM'); finish(new Error('Steam metadata query timed out after 120 seconds.')); }, 120_000);
    timer.unref?.();
  });
}

function readInstalledBuildId() {
  const manifest = `${COMMON_DIR}/steamapps/appmanifest_730.acf`;
  if (!existsSync(manifest)) throw new Error(`Installed Steam manifest is missing: ${manifest}`);
  const match = readFileSync(manifest, 'utf8').match(/"buildid"\s+"(\d+)"/);
  if (!match) throw new Error('Installed CS2 Build ID is missing from appmanifest_730.acf.');
  return match[1];
}

async function main() {
  const sharedEnv = readEnvFile(`${CONFIG_DIR}/.env`);
  const api = createUpdateScheduleClient({
    apiUrl: process.env.DUELPLAY_API_URL || sharedEnv.DUELPLAY_API_URL || '',
    secret: process.env.DUELPLAY_SERVER_MANAGER_SECRET || sharedEnv.DUELPLAY_SERVER_MANAGER_SECRET || '',
  });

  await reconcileStaleMaintenance();

  const heartbeat = async (agentStatus, agentError = null) => {
    try { await api('/api/server-manager/update-schedule/heartbeat', { method: 'POST', body: { agentStatus, agentError } }); }
    catch (error) { console.error(`[DuelPlay CS2 scheduler] heartbeat failed: ${error instanceof Error ? error.message : 'unknown error'}`); }
  };
  const active = spawnSync('/usr/bin/systemctl', ['is-active', '--quiet', 'duelplay-cs2-update.service'], { encoding: 'utf8' });
  if (active.error || ![0, 3].includes(active.status)) throw new Error(`Updater service state is unknown (systemctl exit=${active.status ?? 'null'}).`);
  if (active.status === 0) { await heartbeat('UPDATE_RUNNING'); console.log('[DuelPlay CS2 scheduler] UPDATE_RUNNING'); return; }

  const installedBuildId = readInstalledBuildId();
  const publicBuildId = await querySteamPublicBuildId();
  console.log(`[DuelPlay CS2 scheduler] Build check installed=${installedBuildId} public=${publicBuildId}`);
  if (installedBuildId === publicBuildId) { await heartbeat('ONLINE'); return; }

  await heartbeat('UPDATE_DUE');
  const claim = await api('/api/server-manager/update-schedule/claim', { method: 'POST', body: { source: 'STEAM_BUILD', publicBuildId } });
  if (!claim?.claimed || !claim.runId) {
    console.log(`[DuelPlay CS2 scheduler] ${claim?.reason ?? 'AUTO_UPDATE_NOT_CLAIMED'}${claim?.runId ? ` runId=${claim.runId}` : ''}`);
    await heartbeat('ONLINE', null);
    return;
  }

  const directory = dirname(RUN_ENV_FILE);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const tempPath = `${RUN_ENV_FILE}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `DUELPLAY_CS2_UPDATE_RUN_ID=${claim.runId}\n`, { mode: 0o600, flag: 'wx' });
  renameSync(tempPath, RUN_ENV_FILE);
  let startResult;
  try {
    startResult = await childExit('/usr/bin/sudo', ['-n', '/usr/bin/systemctl', 'start', 'duelplay-cs2-update.service']);
  } finally {
    try { if (existsSync(RUN_ENV_FILE)) unlinkSync(RUN_ENV_FILE); } catch {}
  }
  const run = await api(`/api/server-manager/update-runs?runId=${encodeURIComponent(claim.runId)}`).catch(() => null);
  if (startResult.exitCode !== 0 || !run || run.status === 'RUNNING') {
    const message = `Automatic updater did not finish cleanly (exit=${startResult.exitCode ?? 'null'}, status=${run?.status ?? 'unknown'}).`;
    const interventionRequired = !run
      || run.maintenanceEnabled === true
      || run.syncMarkerActive === true
      || run.interventionRequired === true;
    try {
      await api('/api/server-manager/update-runs', {
        method: 'PATCH',
        body: {
          runId: claim.runId,
          status: 'FAILED',
          stage: run?.stage ?? 'FAILED',
          errorCode: 'AUTO_UPDATE_START_OR_STATUS_FAILED',
          errorMessage: message,
          interventionRequired,
        },
      });
    } catch {}
    await heartbeat('ERROR', message);
    throw new Error(message);
  }
  await heartbeat(['FAILED', 'BLOCKED', 'INSTANCE_DRIFT'].includes(String(run.status)) ? 'ERROR' : 'ONLINE', run.errorMessage ?? null);
  console.log(`[DuelPlay CS2 scheduler] automatic run ${run.status} runId=${claim.runId}`);
}

try {
  await main();
} catch (error) {
  console.error(`[DuelPlay CS2 scheduler] ERROR ${error instanceof Error ? error.message : 'SCHEDULE_CHECK_FAILED'}`);
  process.exitCode = 1;
}
