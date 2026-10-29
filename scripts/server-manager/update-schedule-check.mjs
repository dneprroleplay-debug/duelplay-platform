import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createUpdateScheduleClient } from './update-schedule-client.mjs';
import { pollCs2UpdateSchedule } from '../../lib/cs2-update-poller.mjs';

const CONFIG_DIR = process.env.DUELPLAY_MANAGER_CONFIG_DIR || '/home/ubuntu/duelplay-app/scripts/server-manager';
const RUN_ENV_FILE = process.env.DUELPLAY_CS2_UPDATE_RUN_ENV_FILE || '/run/duelplay-cs2-update-scheduler/run.env';

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

async function main() {
  const sharedEnv = readEnvFile(`${CONFIG_DIR}/.env`);
  const api = createUpdateScheduleClient({
    apiUrl: process.env.DUELPLAY_API_URL || sharedEnv.DUELPLAY_API_URL || '',
    secret: process.env.DUELPLAY_SERVER_MANAGER_SECRET || sharedEnv.DUELPLAY_SERVER_MANAGER_SECRET || '',
  });

  const result = await pollCs2UpdateSchedule({
    readSchedule: () => api('/api/server-manager/update-schedule'),
    updateHeartbeat: body => api('/api/server-manager/update-schedule/heartbeat', { method: 'POST', body }),
    updaterIsActive: () => {
      const status = spawnSync('/usr/bin/systemctl', ['is-active', '--quiet', 'duelplay-cs2-update.service'], { encoding: 'utf8' });
      if (status.error) throw new Error(`Could not query updater service: ${status.error.message}`);
      if (status.status === 0) return true;
      if (status.status === 3) return false;
      throw new Error(`Updater service state is unknown (systemctl exit=${status.status ?? 'null'}).`);
    },
    claimRun: body => api('/api/server-manager/update-schedule/claim', { method: 'POST', body }),
    startUpdater: async runId => {
      const directory = dirname(RUN_ENV_FILE);
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const tempPath = `${RUN_ENV_FILE}.${process.pid}.${Date.now()}.tmp`;
      writeFileSync(tempPath, `DUELPLAY_CS2_UPDATE_RUN_ID=${runId}\n`, { mode: 0o600, flag: 'wx' });
      renameSync(tempPath, RUN_ENV_FILE);
      try {
        return await childExit('/usr/bin/sudo', ['-n', '/usr/bin/systemctl', 'start', 'duelplay-cs2-update.service']);
      } finally {
        try { if (existsSync(RUN_ENV_FILE)) unlinkSync(RUN_ENV_FILE); } catch {}
      }
    },
    readRun: runId => api(`/api/server-manager/update-runs?runId=${encodeURIComponent(runId)}`),
    reportFailure: (runId, failure) => api('/api/server-manager/update-runs', { method: 'PATCH', body: { runId, ...failure, status: 'FAILED', stage: 'FAILED', interventionRequired: true } }),
  });

  if (!['NOT_DUE', 'DISABLED'].includes(result.action)) {
    console.log(`[DuelPlay CS2 scheduler] ${result.action}${result.runId ? ` runId=${result.runId}` : ''}${result.reason ? ` reason=${result.reason}` : ''}${result.error ? ` error=${result.error}` : ''}`);
  }
}

try {
  await main();
} catch (error) {
  console.error(`[DuelPlay CS2 scheduler] ERROR ${error instanceof Error ? error.message : 'SCHEDULE_CHECK_FAILED'}`);
  process.exitCode = 1;
}
