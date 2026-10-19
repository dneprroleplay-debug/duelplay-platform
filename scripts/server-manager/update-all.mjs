import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createSocket } from 'node:dgram';
import { join } from 'node:path';
import { loadInstanceRegistry } from './instance-registry.mjs';
import { inspectComponentRoot, validateComponentManifest } from './component-manifest.mjs';

const CONFIG_DIR = process.env.DUELPLAY_MANAGER_CONFIG_DIR || '/home/ubuntu/duelplay-app/scripts/server-manager';
const COMMON_DIR = process.env.CS2_STEAMCMD_DIR || '/home/ubuntu/cs2';
const GAME_DIR = join(COMMON_DIR, 'game');
const LOG_DIR = process.env.DUELPLAY_CS2_UPDATE_LOG_DIR || '/home/ubuntu/cs2/update-logs';
const BACKUP_DIR = process.env.DUELPLAY_CS2_UPDATE_BACKUP_DIR || '/home/ubuntu/cs2/update-backups';
const API_URL = String(process.env.DUELPLAY_API_URL || '').replace(/\/$/, '');
const MANAGER_SECRET = process.env.DUELPLAY_SERVER_MANAGER_SECRET || '';
const STEAMCMD_BIN = process.env.STEAMCMD_BIN || 'steamcmd';
const APP_ID = String(process.env.CS2_APP_ID || '730');
const DRAIN_TIMEOUT_MS = Number(process.env.DUELPLAY_UPDATE_DRAIN_TIMEOUT_MS || 60 * 60_000);
const MANAGER_TIMEOUT_MS = Number(process.env.DUELPLAY_UPDATE_MANAGER_TIMEOUT_MS || 180_000);
const SMOKE_TIMEOUT_MS = Number(process.env.DUELPLAY_UPDATE_SMOKE_TIMEOUT_MS || 180_000);
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const stamp = new Date().toISOString().replaceAll(':', '-');

mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
const logPath = join(LOG_DIR, `${stamp}.log`);
const logFile = await import('node:fs').then(({ createWriteStream }) => createWriteStream(logPath, { flags: 'wx', mode: 0o600 }));
function log(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  process.stdout.write(line);
  logFile.write(line);
}

function required(value, name) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const servers = loadInstanceRegistry(CONFIG_DIR);

async function managerApi(path, init = {}) {
  const response = await fetch(`${required(API_URL, 'DUELPLAY_API_URL')}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-duelplay-server-secret': required(MANAGER_SECRET, 'DUELPLAY_SERVER_MANAGER_SECRET'), ...(init.headers || {}) },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch {}
  if (!response.ok) throw new Error(`DuelPlay update API returned HTTP ${response.status}${data.errorCode ? ` (${data.errorCode})` : ''}`);
  return data;
}

async function setMaintenance(enabled) {
  return managerApi('/api/server-manager/maintenance', { method: 'POST', body: JSON.stringify({ enabled }) });
}

async function setUpdateStatus(status, error = undefined) {
  const updateStatus = { status, startedAt: runStartedAt.toISOString(), ...(status === 'RUNNING' ? {} : { finishedAt: new Date().toISOString() }), ...(error ? { error: String(error).slice(0, 1000) } : {}) };
  await managerApi('/api/server-manager/maintenance', { method: 'POST', body: JSON.stringify({ updateStatus }) });
}

async function getMaintenanceSnapshot() {
  return managerApi('/api/server-manager/maintenance');
}

async function waitForMatchDrain() {
  const deadline = Date.now() + DRAIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const state = await getMaintenanceSnapshot();
    if (state.activeMatches === 0) {
      log('No STARTING/LIVE matches remain; update may proceed.');
      return;
    }
    log(`Waiting for ${state.activeMatches} active match(es) to finish before updating.`);
    await sleep(15_000);
  }
  throw new Error('Active matches did not drain before the maintenance timeout. The site remains in maintenance.');
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    log(`Starting ${command} ${args.join(' ')}`);
    const child = spawn(command, args, { cwd: options.cwd, env: options.env || process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => { const text = chunk.toString(); log(`[stdout] ${text.trimEnd()}`); });
    child.stderr.on('data', chunk => { const text = chunk.toString(); log(`[stderr] ${text.trimEnd()}`); });
    child.on('error', error => reject(new Error(`${command} failed to start: ${error.message}`)));
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed (exit=${code ?? 'null'}, signal=${signal ?? 'none'})`));
    });
  });
}

function verifyPerServerComponents() {
  const manifest = JSON.parse(readFileSync(new URL('./component-bundle/manifest.json', import.meta.url), 'utf8'));
  validateComponentManifest(manifest);
  if (manifest.approval !== 'APPROVED' || manifest.compatibility !== 'VERIFIED' || manifest.components.some(item => !item.sha256 || !item.version)) {
    throw new Error(`Component bundle ${manifest.bundleVersion} is not approved or fully versioned; update is blocked before SteamCMD. No files were changed.`);
  }
  const failures = [];
  for (const server of servers) {
    for (const result of inspectComponentRoot(server.root, manifest)) {
      log(`${server.name} component ${result.name}: ${result.status}${result.actualHash ? ` sha256=${result.actualHash}` : ''}`);
      if (result.status !== 'PASS') failures.push(`${server.name}:${result.path}:${result.status}`);
    }
  }
  if (failures.length) throw new Error(`Component integrity check failed: ${failures.join(', ')}. No component files were copied or repaired.`);
  log(`All ${servers.length} registered instances match approved component bundle ${manifest.bundleVersion}.`);
}

function ensureMetamodEntry(contents) {
  if (/^\s*Game\s+csgo\/addons\/metamod\s*$/m.test(contents)) return contents;
  const searchPaths = contents.match(/SearchPaths\s*\{/);
  if (!searchPaths) throw new Error('Updated CS2 gameinfo.gi has no SearchPaths block.');
  const insertAt = searchPaths.index + searchPaths[0].length;
  return `${contents.slice(0, insertAt)}\n    Game    csgo/addons/metamod${contents.slice(insertAt)}`;
}

function normalizePerServerGameInfo(server, contents) {
  let updated = ensureMetamodEntry(contents);
  const importedGameInfo = join(server.root, 'csgo_imported/gameinfo.gi');
  if (!existsSync(importedGameInfo)) {
    updated = updated.replace(/^\s*LayeredOnMod\s+csgo_imported\s*\r?\n/gm, '');
  }
  return updated;
}

function syncPerServerGameInfo() {
  const backupRun = join(BACKUP_DIR, stamp);
  for (const server of servers) {
    const filePath = join(server.root, 'csgo/gameinfo.gi');
    if (!existsSync(filePath)) throw new Error(`Instance ${server.name} gameinfo.gi is missing: ${filePath}`);
    const previous = readFileSync(filePath, 'utf8');
    const updated = normalizePerServerGameInfo(server, previous);
    if (previous === updated) {
      log(`${server.name}: instance gameinfo.gi already has the required Metamod search path.`);
      continue;
    }
    mkdirSync(backupRun, { recursive: true, mode: 0o700 });
    const backupPath = join(backupRun, `${server.name}.gameinfo.gi`);
    writeFileSync(backupPath, previous, { mode: 0o600, flag: 'wx' });
    const mode = statSync(filePath).mode & 0o777;
    writeFileSync(filePath, updated, { mode });
    log(`${server.name}: preserved instance gameinfo.gi and applied required loader fixes; previous file saved at ${backupPath}.`);
  }
}

async function udpPortAvailable(port) {
  const socket = createSocket('udp4');
  return new Promise((resolve, reject) => {
    socket.once('error', error => { socket.close(); if (error.code === 'EADDRINUSE') resolve(false); else reject(error); });
    socket.bind(port, '127.0.0.1', () => { socket.close(); resolve(true); });
  });
}

function udpPortListening(pid, port) {
  const portHex = Number(port).toString(16).padStart(4, '0').toUpperCase();
  for (const protocol of ['udp', 'udp6']) {
    try {
      const contents = readFileSync(`/proc/${pid}/net/${protocol}`, 'utf8');
      if (contents.split(/\r?\n/).slice(1).some(line => {
        const columns = line.trim().split(/\s+/);
        return columns[1]?.split(':').pop()?.toUpperCase() === portHex && columns[3] === '07';
      })) return true;
    } catch {}
  }
  return false;
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

async function smokeCheckServer(server) {
  const script = join(server.root, 'cs2.sh');
  if (!existsSync(script)) throw new Error(`${server.name}: cs2.sh is missing.`);
  if (!(await udpPortAvailable(server.port))) throw new Error(`${server.name}: UDP port ${server.port} is already in use; not starting a second process.`);
  const args = [
    '-dedicated', '-console', '-usercon', '-ip', '127.0.0.1', '-port', String(server.port), '-maxplayers', '2',
    '+game_type', '0', '+game_mode', '1', '+map', 'de_dust2', '+sv_lan', '1', '+sv_visiblemaxplayers', '2', '+bot_quota', '0',
  ];
  log(`${server.name}: starting a private loopback CS2 smoke process on UDP ${server.port}.`);
  const child = spawn(script, args, { cwd: server.root, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  const append = (tag, chunk) => {
    const text = chunk.toString();
    output = (output + text).slice(-250_000);
    log(`[${server.name} ${tag}] ${text.trimEnd()}`);
  };
  child.stdout.on('data', chunk => append('CS2', chunk));
  child.stderr.on('data', chunk => append('CS2:ERR', chunk));

  try {
    const deadline = Date.now() + SMOKE_TIMEOUT_MS;
    while (Date.now() < deadline && child.exitCode === null) {
      if (udpPortListening(child.pid, server.port)) break;
      await sleep(1000);
    }
    if (child.exitCode !== null) throw new Error(`${server.name}: CS2 exited before the readiness port opened (code=${child.exitCode}).`);
    if (!udpPortListening(child.pid, server.port)) throw new Error(`${server.name}: CS2 did not open UDP ${server.port} before the startup timeout.`);

    await sleep(5000);
    child.stdin.write('meta list\ncss_plugins list\nduelplay_set_player_name\nduelplay_set_player_avatar\nduelplay_grenade_only\n');
    await sleep(4000);
    const pluginChecks = [
      ['DuelPlayGrenadeOnly', /DuelPlayGrenadeOnly/i],
      ['DuelPlayPlayerName', /DuelPlayPlayerName|DuelPlay Player Name/i],
      ['DuelPlayPlayerAvatar', /DuelPlayPlayerAvatar|DuelPlay.*avatar/i],
    ];
    for (const [label, pattern] of pluginChecks) {
      if (!pattern.test(output)) throw new Error(`${server.name}: smoke output did not confirm ${label} loaded.`);
    }
    for (const [label, path] of [
      ['nickname plugin', 'csgo/addons/counterstrikesharp/plugins/DuelPlayPlayerName/DuelPlayPlayerName.dll'],
      // CounterStrikeSharp loads plugins from their named subdirectory; the legacy
      // root-level DuelPlayGrenadeOnly.dll is no longer shipped or installed.
      ['grenade plugin', 'csgo/addons/counterstrikesharp/plugins/DuelPlayGrenadeOnly/DuelPlayGrenadeOnly.dll'],
      ['avatar plugin', 'csgo/addons/duelplayplayeravatar/bin/linuxsteamrt64/DuelPlayPlayerAvatar.so'],
      ['avatar loader', 'csgo/addons/metamod/duelplayplayeravatar.vdf'],
    ]) if (!existsSync(join(server.root, path))) throw new Error(`${server.name}: ${label} file is missing after startup.`);
    log(`${server.name}: loopback game port and all DuelPlay plugin load checks passed.`);
  } finally {
    if (child.exitCode === null) {
      try { child.stdin.write('quit\n'); } catch {}
      await waitForExit(child, 15_000);
      if (child.exitCode === null) child.kill('SIGTERM');
      await waitForExit(child, 5_000);
      if (child.exitCode === null) child.kill('SIGKILL');
      await waitForExit(child, 5_000);
    }
  }
}

async function waitForManagers() {
  const deadline = Date.now() + MANAGER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const state = await getMaintenanceSnapshot();
    const allReady = servers.every(server => {
      const entry = state.servers.find(item => item.name === server.name);
      return entry?.status === 'READY' && entry.managerReady === true && Number(entry.port) === server.port && Number(entry.managerPort) === server.managerPort && !entry.matchId && entry.heartbeatFresh;
    });
    let allHealthEndpoints = true;
    for (const server of servers) {
      try {
        const response = await fetch(`http://127.0.0.1:${server.managerPort}/health`, { signal: AbortSignal.timeout(2000) });
        const data = await response.json();
        if (!response.ok || data.ok !== true || data.matchId) allHealthEndpoints = false;
      } catch { allHealthEndpoints = false; }
    }
    if (allReady && allHealthEndpoints) {
      log(`All ${servers.length} manager health endpoints and fresh database readiness records passed.`);
      return;
    }
    log('Waiting for all three manager processes and readiness heartbeats.');
    await sleep(5000);
  }
  throw new Error('One or more CS2 managers did not become ready. The site remains in maintenance.');
}

const runStartedAt = new Date();

async function main() {
  required(API_URL, 'DUELPLAY_API_URL');
  required(MANAGER_SECRET, 'DUELPLAY_SERVER_MANAGER_SECRET');
  log(`CS2 shared-install update started; persistent log: ${logPath}`);
  verifyPerServerComponents();
  await setMaintenance(true);
  await setUpdateStatus('RUNNING');
  log('Website maintenance is enabled.');
  await waitForMatchDrain();

  await runProcess(STEAMCMD_BIN, [
    '+force_install_dir', COMMON_DIR,
    '+login', 'anonymous',
    '+app_update', APP_ID, 'validate',
    '+quit',
  ], { cwd: GAME_DIR });
  log('SteamCMD validated the single shared CS2 installation.');

  syncPerServerGameInfo();
  for (const server of servers) await smokeCheckServer(server);
  await waitForManagers();
  await setUpdateStatus('SUCCEEDED');
  await setMaintenance(false);
  log('All smoke tests passed; maintenance was disabled and the site returned to service.');
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown CS2 update failure';
  log(`ERROR: ${message}`);
  try {
    await setUpdateStatus('FAILED', message);
    log('Failure status was recorded. Maintenance remains enabled.');
  } catch (statusError) {
    log(`Could not record failure status through the app API: ${statusError instanceof Error ? statusError.message : 'unknown API error'}`);
  }
  process.exitCode = 1;
} finally {
  await new Promise(resolve => logFile.end(resolve));
}
