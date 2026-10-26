import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createSocket } from 'node:dgram';
import { dirname, join } from 'node:path';
import { loadInstanceRegistry } from './instance-registry.mjs';
import { inspectComponentRoot, validateComponentManifest } from './component-manifest.mjs';
import { CONTROL_FILES, assertManagersIdle, classifySmokeProcessExit, parseBooleanFlag, parseSteamPublicBuildId, selectSyncMode, selectUpdateAction, syncInstances } from './sync-policy.mjs';
import { createUpdateScheduleClient } from './update-schedule-client.mjs';

const CONFIG_DIR = process.env.DUELPLAY_MANAGER_CONFIG_DIR || '/home/ubuntu/duelplay-app/scripts/server-manager';
const SHARED_ENV = parseEnvFile(join(CONFIG_DIR, '.env'));
const COMMON_DIR = process.env.CS2_STEAMCMD_DIR || '/home/ubuntu/cs2';
const GAME_DIR = join(COMMON_DIR, 'game');
const LOG_DIR = process.env.DUELPLAY_CS2_UPDATE_LOG_DIR || '/home/ubuntu/cs2/update-logs';
const API_URL = String(process.env.DUELPLAY_API_URL || SHARED_ENV.DUELPLAY_API_URL || '').replace(/\/$/, '');
const MANAGER_SECRET = process.env.DUELPLAY_SERVER_MANAGER_SECRET || SHARED_ENV.DUELPLAY_SERVER_MANAGER_SECRET || '';
const STEAMCMD_BIN = process.env.STEAMCMD_BIN || 'steamcmd';
const APP_ID = String(process.env.CS2_APP_ID || '730');
const DRAIN_TIMEOUT_MS = Number(process.env.DUELPLAY_UPDATE_DRAIN_TIMEOUT_MS || 60 * 60_000);
const MANAGER_TIMEOUT_MS = Number(process.env.DUELPLAY_UPDATE_MANAGER_TIMEOUT_MS || 180_000);
const SMOKE_TIMEOUT_MS = Number(process.env.DUELPLAY_UPDATE_SMOKE_TIMEOUT_MS || 180_000);
const SYNC_MARKER = process.env.DUELPLAY_CS2_SYNC_MARKER || join(COMMON_DIR, '.duelplay-sync-in-progress');
const STATE_FILE = process.env.DUELPLAY_CS2_UPDATE_STATE_FILE || join(COMMON_DIR, '.duelplay-cs2-update-state.json');
const FORCE_DEEP_VERIFY = parseBooleanFlag(process.env.DUELPLAY_CS2_DEEP_VERIFY) || process.argv.includes('--force');
const RUN_ID_ARG_INDEX = process.argv.indexOf('--run-id');
const UPDATE_RUN_ID = process.env.DUELPLAY_CS2_UPDATE_RUN_ID || (RUN_ID_ARG_INDEX >= 0 ? process.argv[RUN_ID_ARG_INDEX + 1] : '') || '';
let updateScheduleApi;
const SYNC_EXCLUDES = [
  '--exclude=/steamapps',
  '--exclude=/csgo/addons',
  '--exclude=/csgo/cfg',
  '--exclude=/csgo/logs',
  '--exclude=/csgo/replays',
  '--exclude=/csgo/screenshots',
  '--exclude=/csgo/maps/workshop',
  '--exclude=/bin/linuxsteamrt64/steamapps/workshop',
  '--exclude=/csgo/gameinfo.gi',
  '--exclude=/bin/linuxsteamrt64/counterstrikesharp.log',
];
const DRIFT_EXCLUDES = SYNC_EXCLUDES.filter(value => value !== '--exclude=/csgo/maps/workshop' && value !== '--exclude=/bin/linuxsteamrt64/steamapps/workshop');
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

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) throw new Error(`Missing per-server environment file: ${filePath}`);
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

const servers = loadInstanceRegistry(CONFIG_DIR);
const expectedServerOrder = ['cs2-1', 'cs2-2', 'cs2-3'];
if (servers.map(server => server.name).join(',') !== expectedServerOrder.join(',')) {
  throw new Error(`Expected exactly ${expectedServerOrder.join(',')} in numeric instance order; found ${servers.map(server => server.name).join(',') || 'none'}.`);
}

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
  const updateStatus = { status, startedAt: runStartedAt.toISOString(), ...(UPDATE_RUN_ID ? { runId: UPDATE_RUN_ID } : {}), ...(status === 'RUNNING' ? {} : { finishedAt: new Date().toISOString() }), ...(error ? { error: String(error).slice(0, 1000) } : {}) };
  await managerApi('/api/server-manager/maintenance', { method: 'POST', body: JSON.stringify({ updateStatus }) });
}

let currentStage = 'BOOT';
const checkedInstances = [];
const updateDiagnostics = [];

function updateRunApi() {
  if (!updateScheduleApi) updateScheduleApi = createUpdateScheduleClient({ apiUrl: API_URL, secret: MANAGER_SECRET });
  return updateScheduleApi;
}

async function reportUpdateRun(patch) {
  if (!UPDATE_RUN_ID) throw new Error('SCHEDULED_UPDATE_RUN_ID_REQUIRED');
  return updateRunApi()('/api/server-manager/update-runs', { method: 'PATCH', body: { runId: UPDATE_RUN_ID, stage: currentStage, ...patch } });
}

async function setUpdateStage(stage, patch = {}) {
  currentStage = stage;
  await reportUpdateRun(patch);
}

function recordInstanceCheck(result) {
  const index = checkedInstances.findIndex(item => item.serverName === result.serverName);
  if (index >= 0) checkedInstances[index] = { ...checkedInstances[index], ...result };
  else checkedInstances.push(result);
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

function hashFile(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function readCs2Build(root) {
  try {
    const contents = readFileSync(join(root, 'csgo', 'steam.inf'), 'utf8');
    const match = contents.match(/^ServerVersion=(.+)$/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

function readSharedBuildId() {
  try {
    const contents = readFileSync(join(COMMON_DIR, 'steamapps', 'appmanifest_730.acf'), 'utf8');
    const match = contents.match(/"buildid"\s+"(\d+)"/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function readUpdateState() {
  if (!existsSync(STATE_FILE)) return null;
  try {
    const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    return state?.schemaVersion === 1 ? state : null;
  } catch (error) {
    log(`Saved updater state is unreadable; treating it as unknown (${error instanceof Error ? error.message : 'invalid JSON'}).`);
    return null;
  }
}

function persistUpdateState(state) {
  mkdirSync(dirname(STATE_FILE), { recursive: true, mode: 0o700 });
  const tempPath = `${STATE_FILE}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  renameSync(tempPath, STATE_FILE);
}

function persistAttempt(result, details = {}) {
  const state = readUpdateState() || { schemaVersion: 1, lastSuccessful: null };
  persistUpdateState({
    ...state,
    schemaVersion: 1,
    lastAttempt: { result, finishedAt: new Date().toISOString(), ...details },
  });
}

function collectControlHashes(root) {
  return Object.fromEntries(CONTROL_FILES.map(relativePath => [relativePath, hashFile(join(root, relativePath))]));
}

function sameHashMap(left, right) {
  return Boolean(left && right) && CONTROL_FILES.every(relativePath => left[relativePath] && left[relativePath] === right[relativePath]);
}

function createSuccessfulState(buildId, serverVersion, completedAt = new Date().toISOString(), result = 'SUCCEEDED') {
  const sharedControlFiles = collectControlHashes(GAME_DIR);
  const instances = servers.map(server => ({
    name: server.name,
    root: server.root,
    serverVersion: readCs2Build(server.root),
    controlFiles: collectControlHashes(server.root),
  }));
  return {
    schemaVersion: 1,
    lastSuccessful: {
      result,
      buildId,
      serverVersion,
      completedAt,
      controlFiles: sharedControlFiles,
      instances,
    },
    lastAttempt: { result, buildId, finishedAt: new Date().toISOString() },
  };
}

function querySteamPublicBuildId() {
  return new Promise((resolve, reject) => {
    log(`Querying Steam public branch Build ID for app ${APP_ID} (metadata only; no app_update).`);
    const child = spawn(STEAMCMD_BIN, ['+login', 'anonymous', '+app_info_update', '1', '+app_info_print', APP_ID, '+quit'], {
      cwd: COMMON_DIR,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let settled = false;
    const finish = (error, buildId = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(buildId);
    };
    const append = chunk => {
      output += chunk.toString();
      if (output.length > 4_000_000) output = output.slice(-4_000_000);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', error => finish(new Error(`Steam metadata query failed to start: ${error.message}`, { cause: error })));
    child.on('close', (code, signal) => {
      if (code !== 0) return finish(new Error(`Steam metadata query failed (exit=${code ?? 'null'}, signal=${signal ?? 'none'}).`));
      const buildId = parseSteamPublicBuildId(output);
      if (!buildId) return finish(new Error('Steam metadata did not contain a public branch Build ID.'));
      log(`Steam public branch Build ID: ${buildId}.`);
      finish(null, buildId);
    });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(new Error('Steam metadata query timed out after 120 seconds.'));
    }, 120_000);
    timer.unref?.();
  });
}

function rsyncDriftCheck(server) {
  return new Promise((resolve, reject) => {
    const args = [
      '-acni',
      // --delete is paired with -n only, so target-only files are reported as drift and never removed.
      '--delete',
      '--out-format=DUELPLAY_CHANGE:%i:%n',
      ...DRIFT_EXCLUDES,
      `${GAME_DIR}/`,
      `${server.root}/`,
    ];
    const child = spawn('rsync', args, { cwd: COMMON_DIR, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let pending = '';
    let stderr = '';
    const changes = [];
    const consumeLines = (text, final = false) => {
      const lines = text.split(/\r?\n/);
      if (!final) pending = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('DUELPLAY_CHANGE:')) continue;
        const splitAt = line.indexOf(':', 'DUELPLAY_CHANGE:'.length);
        if (splitAt < 0) continue;
        const item = line.slice('DUELPLAY_CHANGE:'.length, splitAt);
        const relativePath = line.slice(splitAt + 1);
        if (relativePath === './' || relativePath === '.') continue;
        if (relativePath === 'bin/linuxsteamrt64/steam_appid.txt') {
          const source = join(GAME_DIR, relativePath);
          const target = join(server.root, relativePath);
          if (existsSync(source) && existsSync(target) && hashFile(source) === hashFile(target)) continue;
        }
        changes.push({ item, path: relativePath });
      }
      if (final && pending) {
        consumeLines(`${pending}\n`, false);
        pending = '';
      }
    };
    child.stdout.on('data', chunk => {
      const text = pending + chunk.toString();
      pending = '';
      consumeLines(text);
    });
    child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-4000); });
    child.on('error', error => reject(new Error(`rsync quick check failed to start for ${server.name}: ${error.message}`, { cause: error })));
    child.on('close', (code, signal) => {
      consumeLines('', true);
      if (code !== 0) return reject(new Error(`${server.name}: rsync quick check failed (exit=${code ?? 'null'}, signal=${signal ?? 'none'})${stderr ? `: ${stderr.trim()}` : ''}`));
      resolve({ clean: changes.length === 0, changes });
    });
  });
}

async function inspectInstanceDrift(sharedBuildId) {
  const differences = [];
  const checks = [];
  for (const server of servers) {
    const check = await rsyncDriftCheck(server);
    const serverDifferences = check.changes.map(change => ({ server: server.name, ...change }));
    differences.push(...serverDifferences);
    checks.push({ serverName: server.name, status: serverDifferences.length ? 'INSTANCE_DRIFT' : 'MATCH', buildId: sharedBuildId, serverVersion: readCs2Build(server.root), differingFiles: serverDifferences.length, controlFilesVerified: false });
  }
  const pluginDifferences = findProductionPluginDrift();
  differences.push(...pluginDifferences);
  for (const check of checks) {
    const pluginDiffCount = pluginDifferences.filter(difference => difference.server === check.serverName).length;
    if (pluginDiffCount) {
      check.status = 'INSTANCE_DRIFT';
      check.differingFiles += pluginDiffCount;
    }
  }
  return { differences, checks };
}

function logInstanceDrift(differences, installedBuildId, publicBuildId) {
  log(`INSTANCE_DRIFT installedBuildId=${installedBuildId} publicBuildId=${publicBuildId} differingFiles=${differences.length}; no automatic repair will be attempted.`);
  for (const difference of differences) {
    log(`INSTANCE_DRIFT server=${difference.server} item=${difference.item} path=${JSON.stringify(difference.path)}`);
  }
}

function instanceDriftDiagnostics(differences) {
  const occurredAt = new Date().toISOString();
  return differences.map(difference => ({
    code: difference.item === 'HASH_MISMATCH' || difference.item === 'MISSING' || difference.item === 'MISSING_REFERENCE' ? 'PROTECTED_PLUGIN_DRIFT' : 'INSTANCE_DRIFT',
    serverName: difference.server,
    message: String(difference.item ?? 'DIFFERING_FILE'),
    path: difference.path,
    occurredAt,
  }));
}

async function verifyRecordedInstanceState(state, installedBuildId, sharedVersion) {
  const lastSuccessful = state?.lastSuccessful;
  if (!lastSuccessful || lastSuccessful.buildId !== installedBuildId || lastSuccessful.serverVersion !== sharedVersion) return false;
  verifyProductionPluginParity();
  const sharedControlFiles = collectControlHashes(GAME_DIR);
  if (!sameHashMap(sharedControlFiles, lastSuccessful.controlFiles)) return false;
  const savedInstances = new Map((lastSuccessful.instances || []).map(instance => [instance.name, instance]));
  for (const server of servers) {
    const saved = savedInstances.get(server.name);
    if (!saved || saved.root !== server.root || saved.serverVersion !== sharedVersion) return false;
    if (readCs2Build(server.root) !== sharedVersion) return false;
    const instanceControlFiles = collectControlHashes(server.root);
    if (!sameHashMap(instanceControlFiles, sharedControlFiles) || !sameHashMap(instanceControlFiles, saved.controlFiles)) return false;
    const gameInfo = join(server.root, 'csgo', 'gameinfo.gi');
    if (!existsSync(gameInfo) || normalizePerServerGameInfo(server, readFileSync(gameInfo, 'utf8')) !== readFileSync(gameInfo, 'utf8')) return false;
    const drift = await rsyncDriftCheck(server);
    if (!drift.clean) {
      log(`${server.name}: checksum dry-run found ${drift.changes.length} differing path(s); the saved state is not adoptable.`);
      return false;
    }
  }
  return true;
}

function cs2ProcessesRunning() {
  try {
    const result = spawnSync('pgrep', ['-x', 'cs2'], { encoding: 'utf8' });
    return result.status === 0 && String(result.stdout || '').trim().length > 0;
  } catch {
    return false;
  }
}

function beginSyncMarker() {
  writeFileSync(SYNC_MARKER, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), { mode: 0o600 });
  log(`Sync marker created: ${SYNC_MARKER}. New match starts are blocked until the update finishes.`);
}

function clearSyncMarker(reason) {
  try {
    if (existsSync(SYNC_MARKER)) {
      unlinkSync(SYNC_MARKER);
      log(`Sync marker removed (${reason}).`);
    }
    return true;
  } catch (error) {
    log(`Could not remove sync marker (${reason}): ${error instanceof Error ? error.message : 'unknown error'}`);
    return false;
  }
}

async function assertInstancesIdle() {
  const healthRecords = [];
  for (const server of servers) {
    let health;
    try {
      const response = await fetch(`http://127.0.0.1:${server.managerPort}/health`, { signal: AbortSignal.timeout(3000) });
      health = await response.json();
    } catch (error) {
      throw new Error(`${server.name}: manager health is unavailable; deferring update (${error instanceof Error ? error.message : 'unknown error'}).`);
    }
    healthRecords.push({ server, health });
  }
  assertManagersIdle(healthRecords);
  if (cs2ProcessesRunning()) throw new Error('A CS2 process is running outside the manager idle state; deferring update.');
  log(`All ${servers.length} instances report STOPPED with no assigned match; safe to update.`);
}

async function syncInstanceFromShared(server, deep) {
  await runProcess('rsync', [
    '-a',
    ...(deep ? ['--checksum'] : []),
    ...SYNC_EXCLUDES,
    `${GAME_DIR}/`, `${server.root}/`
  ], { cwd: COMMON_DIR });
}

function verifyInstanceMatchesShared(server, sharedBuild) {
  const instanceBuild = readCs2Build(server.root);
  if (instanceBuild !== sharedBuild) throw new Error(`${server.name}: version ${instanceBuild ?? 'unknown'} does not match shared ${sharedBuild}.`);
  for (const relativePath of CONTROL_FILES) {
    const sharedPath = join(GAME_DIR, relativePath);
    const instancePath = join(server.root, relativePath);
    if (!existsSync(sharedPath) || !existsSync(instancePath)) throw new Error(`${server.name}: control file ${relativePath} is missing.`);
    const sharedHash = hashFile(sharedPath);
    const instanceHash = hashFile(instancePath);
    if (sharedHash !== instanceHash) throw new Error(`${server.name}: control file ${relativePath} hash ${instanceHash} does not match shared ${sharedHash}.`);
  }
  log(`${server.name}: build ${instanceBuild} and control files match the shared installation.`);
}

function verifyPerServerComponents() {
  const manifest = JSON.parse(readFileSync(new URL('./component-bundle/manifest.json', import.meta.url), 'utf8'));
  validateComponentManifest(manifest);
  if (manifest.approval === 'UNVERIFIED' && manifest.compatibility === 'UNKNOWN') {
    verifyProductionPluginParity();
    log(`Component bundle ${manifest.bundleVersion} is unverified; all protected production plugin files were checked for parity and will be preserved unchanged.`);
    return;
  }
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

function findProductionPluginDrift() {
  const referenceServer = servers.find(server => server.name === 'cs2-3');
  if (!referenceServer) throw new Error('Production plugin reference instance cs2-3 is missing.');
  const protectedFiles = [
    'csgo/addons/counterstrikesharp/plugins/DuelPlayGrenadeOnly/DuelPlayGrenadeOnly.dll',
    'csgo/addons/duelplayplayeravatar/bin/linuxsteamrt64/DuelPlayPlayerAvatar.so',
    'csgo/addons/metamod/duelplayplayeravatar.vdf',
    'csgo/addons/counterstrikesharp/plugins/DuelPlayPlayerName/DuelPlayPlayerName.dll',
  ];
  const differences = [];
  for (const relativePath of protectedFiles) {
    const referencePath = join(referenceServer.root, relativePath);
    if (!existsSync(referencePath)) {
      differences.push({ server: referenceServer.name, item: 'MISSING_REFERENCE', path: relativePath });
      continue;
    }
    const referenceHash = hashFile(referencePath);
    for (const server of servers) {
      const componentPath = join(server.root, relativePath);
      if (!existsSync(componentPath)) {
        differences.push({ server: server.name, item: 'MISSING', path: relativePath });
        continue;
      }
      const actualHash = hashFile(componentPath);
      if (actualHash !== referenceHash) differences.push({ server: server.name, item: 'HASH_MISMATCH', path: relativePath });
    }
  }
  return differences;
}

function verifyProductionPluginParity() {
  const differences = findProductionPluginDrift();
  if (differences.length) {
    throw new Error(`Protected production plugin drift: ${differences.map(({ server, path, item }) => `${server}:${path}:${item}`).join(', ')}; leaving all copies untouched.`);
  }
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
  if (child.closed) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once('close', () => { clearTimeout(timer); resolve(); });
  });
}

async function smokeCheckServer(server) {
  const script = join(server.root, 'cs2.sh');
  if (!existsSync(script)) throw new Error(`${server.name}: cs2.sh is missing.`);
  if (!(await udpPortAvailable(server.port))) throw new Error(`${server.name}: UDP port ${server.port} is already in use; not starting a second process.`);
  const args = [
    '-dedicated', '-console', '-usercon', '-ip', '127.0.0.1', '-port', String(server.port), '-maxplayers', '2',
    '+game_type', '0', '+game_mode', '1', '+map', 'de_dust2', '+sv_lan', '1', '+sv_cheats', '0', '+sv_visiblemaxplayers', '2', '+bot_quota', '0',
  ];
  log(`${server.name}: starting a private loopback CS2 smoke process on UDP ${server.port}.`);
  const child = spawn(script, args, { cwd: server.root, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  let spawnError = null;
  let readinessChecksPassed = false;
  let quitRequested = false;
  const append = (tag, chunk) => {
    const text = chunk.toString();
    output = (output + text).slice(-250_000);
    log(`[${server.name} ${tag}] ${text.trimEnd()}`);
  };
  child.stdout.on('data', chunk => append('CS2', chunk));
  child.stderr.on('data', chunk => append('CS2:ERR', chunk));
  child.on('error', error => { spawnError = error; });

  let smokeError = null;
  try {
    const deadline = Date.now() + SMOKE_TIMEOUT_MS;
    while (Date.now() < deadline && child.exitCode === null && !spawnError) {
      if (udpPortListening(child.pid, server.port)) break;
      await sleep(1000);
    }
    if (spawnError) throw new Error(`${server.name}: CS2 smoke process failed to start: ${spawnError.message}`, { cause: spawnError });
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
    readinessChecksPassed = true;
    log(`${server.name}: loopback game port and all DuelPlay plugin load checks passed.`);
  } catch (error) {
    smokeError = error;
  } finally {
    if (child.exitCode === null && !spawnError) {
      try { child.stdin.write('quit\n'); quitRequested = true; } catch {}
      await waitForExit(child, 15_000);
      if (child.exitCode === null) child.kill('SIGTERM');
      await waitForExit(child, 5_000);
      if (child.exitCode === null) child.kill('SIGKILL');
      await waitForExit(child, 5_000);
    }
  }
  if (smokeError) throw smokeError;
  const outcome = classifySmokeProcessExit({ exitCode: child.exitCode, signalCode: child.signalCode, readinessChecksPassed, quitRequested, output });
  if (outcome.status === 'FAILED') throw new Error(`${server.name}: smoke readiness did not finish safely (${JSON.stringify(outcome.diagnostic)}).`);
  if (outcome.status === 'READY_WITH_SHUTDOWN_DIAGNOSTIC') {
    log(`${server.name}: READY_WITH_SHUTDOWN_DIAGNOSTIC ${JSON.stringify(outcome.diagnostic)}; readiness passed before controlled quit, but shutdown was not clean.`);
    return { serverName: server.name, status: outcome.status, diagnostics: [outcome.diagnostic] };
  }
  return { serverName: server.name, status: outcome.status, diagnostics: [] };
}

async function waitForManagers() {
  const deadline = Date.now() + MANAGER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const state = await getMaintenanceSnapshot();
    const allReady = servers.every(server => {
      const entry = state.servers.find(item => item.name === server.name);
      return entry?.status === 'READY' && entry.managerReady === true && Number(entry.port) === server.port && Number(entry.managerPort) === server.managerPort && !entry.matchId && entry.heartbeatFresh && entry.gameProcessReady === false && entry.gameProcessStatus === 'STOPPED' && !entry.gameProcessPid && !entry.processId;
    });
    let allHealthEndpoints = true;
    for (const server of servers) {
      try {
        const response = await fetch(`http://127.0.0.1:${server.managerPort}/health`, { signal: AbortSignal.timeout(2000) });
        const data = await response.json();
        if (!response.ok || data.ok !== true || data.managerReady !== true || data.matchId || data.gameProcessReady !== false || data.gameProcessStatus !== 'STOPPED' || data.gameProcessPid) allHealthEndpoints = false;
      } catch { allHealthEndpoints = false; }
    }
    if (allReady && allHealthEndpoints) {
      log(`All ${servers.length} manager health endpoints and fresh database readiness records passed.`);
      return state.servers;
    }
    log('Waiting for all three manager processes and readiness heartbeats.');
    await sleep(5000);
  }
  throw new Error('One or more CS2 managers did not become ready. The site remains in maintenance.');
}

const runStartedAt = new Date();
let maintenanceTouched = false;
let previousMaintenance = false;
let mutationStarted = false;
let shuttingDown = false;

// Pre-flight failures happen before SteamCMD changes anything, so the previous maintenance
// state can be restored instead of leaving every visitor on the maintenance screen until a
// human notices. A failure after server changes began keeps maintenance enabled on purpose.
async function restoreMaintenanceIfSafe(reason) {
  if (!maintenanceTouched || mutationStarted) return false;
  try {
    await setMaintenance(previousMaintenance);
    maintenanceTouched = false;
    log(`Update did not reach server changes (${reason}); maintenance restored to ${previousMaintenance ? 'enabled' : 'disabled'}.`);
    return true;
  } catch (error) {
    log(`Could not restore the previous maintenance state after ${reason}: ${error instanceof Error ? error.message : 'unknown API error'}`);
    return false;
  }
}

async function finishAndExit(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`Received ${signal}; stopping the update safely.`);
  if (!mutationStarted) {
    await restoreMaintenanceIfSafe(`${signal} before server changes`);
    clearSyncMarker(`${signal} before server changes`);
  } else {
    log('The update had already started changing the server; maintenance and the sync marker stay in place until the update finishes.');
  }
  await new Promise(resolve => logFile.end(resolve));
  process.exit(signal === 'SIGINT' ? 130 : 143);
}

process.on('SIGTERM', () => { void finishAndExit('SIGTERM'); });
process.on('SIGINT', () => { void finishAndExit('SIGINT'); });

function maintenanceSnapshotReadyForAdoption(snapshot) {
  return snapshot?.maintenance === false
    && snapshot.activeMatches === 0
    && snapshot.updateStatus?.status === 'SUCCEEDED'
    && Array.isArray(snapshot.servers)
    && servers.every(server => {
      const entry = snapshot.servers.find(item => item.name === server.name);
      return entry?.status === 'READY' && entry.managerReady === true && !entry.matchId && entry.heartbeatFresh === true;
    });
}

async function adoptCurrentSuccessfulState() {
  required(API_URL, 'DUELPLAY_API_URL');
  required(MANAGER_SECRET, 'DUELPLAY_SERVER_MANAGER_SECRET');
  log('Adopting state from the already completed successful update; this mode does not run app_update or modify game files.');
  verifyPerServerComponents();
  const snapshot = await getMaintenanceSnapshot();
  if (!maintenanceSnapshotReadyForAdoption(snapshot)) throw new Error('Current API state is not a completed, idle, healthy three-server success; state was not adopted.');
  const steamBuildId = await querySteamPublicBuildId();
  const installedBuildId = readSharedBuildId();
  const serverVersion = readCs2Build(GAME_DIR);
  if (!installedBuildId || steamBuildId !== installedBuildId || !serverVersion) {
    throw new Error(`Cannot adopt state: Steam public Build ID ${steamBuildId ?? 'unknown'} does not match installed ${installedBuildId ?? 'unknown'}, or server version is unavailable.`);
  }
  const observed = createSuccessfulState(installedBuildId, serverVersion, snapshot.updateStatus.finishedAt, 'SUCCEEDED');
  if (!await verifyRecordedInstanceState(observed, installedBuildId, serverVersion)) {
    throw new Error('Cannot adopt state: checksum rsync dry-runs, per-instance gameinfo, build versions, or critical-file hashes do not confirm all three roots.');
  }
  persistUpdateState(observed);
  log(`Verified state recorded for Build ID ${installedBuildId} / ServerVersion ${serverVersion}; no app_update or file synchronization was performed.`);
}

const isAdoptingCurrentState = process.argv.includes('--adopt-current-success');
const isScheduledRun = process.argv.includes('--scheduled');

async function main() {
  if (!isScheduledRun || !/^[0-9a-f-]{36}$/i.test(UPDATE_RUN_ID)) throw new Error('SCHEDULED_UPDATE_RUN_CLAIM_REQUIRED; refusing to query Steam or modify any files.');
  required(API_URL, 'DUELPLAY_API_URL');
  required(MANAGER_SECRET, 'DUELPLAY_SERVER_MANAGER_SECRET');
  log(`CS2 shared-install update started; persistent log: ${logPath}`);
  currentStage = 'SCHEDULE_CLAIMED';
  await updateRunApi()(`/api/server-manager/update-runs/active?runId=${encodeURIComponent(UPDATE_RUN_ID)}`);
  await reportUpdateRun({ status: 'RUNNING', stage: currentStage, maintenanceEnabled: false, syncMarkerActive: false });

  currentStage = 'BUILD_ID_CHECK';
  const buildIdBefore = readSharedBuildId();
  log(`Shared CS2 build before update: ${readCs2Build(GAME_DIR) ?? 'unknown'} (buildid ${buildIdBefore ?? 'unknown'}).`);
  for (const server of servers) log(`${server.name}: instance build before update: ${readCs2Build(server.root) ?? 'unknown'}.`);
  const latestBuildId = await querySteamPublicBuildId();
  await reportUpdateRun({ stage: currentStage, publicBuildId: latestBuildId, installedBuildIdBefore: buildIdBefore });

  if (!buildIdBefore) throw new Error('Installed shared Steam Build ID is unavailable; refusing to update or synchronize any files.');
  const plan = selectUpdateAction({ latestBuildId, installedBuildId: buildIdBefore });
  if (plan.action === 'BLOCKED') throw new Error(`${plan.reason}; refusing to update or synchronize any files.`);
  log(`Build comparison: installedBuildId=${buildIdBefore} publicBuildId=${latestBuildId}.`);

  if (plan.action === 'NO_UPDATE') {
    log(`NO_UPDATE installedBuildId=${buildIdBefore} publicBuildId=${latestBuildId}; Steam has no newer official build.`);
    log('Steam Build ID is unchanged; checking instance roots with read-only rsync checksum dry-runs.');
    currentStage = 'INSTANCE_DRIFT_CHECK';
    const inspection = await inspectInstanceDrift();
    checkedInstances.splice(0, checkedInstances.length, ...inspection.checks);
    updateDiagnostics.splice(0, updateDiagnostics.length, ...instanceDriftDiagnostics(inspection.differences));
    await reportUpdateRun({ stage: currentStage, checkedInstances, publicBuildId: latestBuildId, installedBuildIdBefore: buildIdBefore, diagnostics: updateDiagnostics });
    const observedPlan = selectUpdateAction({ latestBuildId, installedBuildId: buildIdBefore, instanceDrift: inspection.differences });
    if (observedPlan.action === 'INSTANCE_DRIFT') {
      logInstanceDrift(inspection.differences, buildIdBefore, latestBuildId);
      persistAttempt('INSTANCE_DRIFT', { installedBuildId: buildIdBefore, publicBuildId: latestBuildId, differingFiles: inspection.differences.length });
      await setUpdateStatus('INSTANCE_DRIFT');
      currentStage = 'INSTANCE_DRIFT';
      await reportUpdateRun({ status: 'INSTANCE_DRIFT', stage: currentStage, interventionRequired: true, maintenanceEnabled: false, syncMarkerActive: false, checkedInstances, diagnostics: updateDiagnostics });
      return;
    }
    log('NO_UPDATE: no instance drift; no app_update, maintenance marker, file sync, or CS2 smoke process is needed.');
    persistAttempt('NO_UPDATE', { installedBuildId: buildIdBefore, publicBuildId: latestBuildId });
    await setUpdateStatus('NO_UPDATE');
    currentStage = 'NO_UPDATE';
    await reportUpdateRun({ status: 'NO_UPDATE', stage: currentStage, interventionRequired: false, maintenanceEnabled: false, syncMarkerActive: false, checkedInstances, diagnostics: [] });
    return;
  }

  log(`Update decision: ${plan.action} (${plan.reason}).`);
  if (plan.action !== 'UPDATE' || !plan.runAppUpdate || !plan.runSync) throw new Error(`Unexpected update plan ${plan.action}; refusing to mutate files.`);
  currentStage = 'INSTANCE_DRIFT_CHECK';
  const preUpdateInspection = await inspectInstanceDrift();
  checkedInstances.splice(0, checkedInstances.length, ...preUpdateInspection.checks);
  updateDiagnostics.splice(0, updateDiagnostics.length, ...instanceDriftDiagnostics(preUpdateInspection.differences));
  await reportUpdateRun({ stage: currentStage, checkedInstances, diagnostics: updateDiagnostics, publicBuildId: latestBuildId, installedBuildIdBefore: buildIdBefore });
  const preExistingConflicts = preUpdateInspection.differences.filter(difference => !difference.item.startsWith('*deleting'));
  const preExistingTargetOnly = preUpdateInspection.differences.length - preExistingConflicts.length;
  if (preUpdateInspection.differences.length) logInstanceDrift(preUpdateInspection.differences, buildIdBefore, latestBuildId);
  if (preExistingConflicts.length) {
    log(`UPDATE_BLOCKED_BY_INSTANCE_DRIFT conflictingFiles=${preExistingConflicts.length}; no files were changed.`);
    persistAttempt('INSTANCE_DRIFT', { installedBuildId: buildIdBefore, publicBuildId: latestBuildId, differingFiles: preExistingConflicts.length });
    currentStage = 'BLOCKED';
    await setUpdateStatus('BLOCKED', 'Pre-existing source/instance drift requires review before updating.');
    await reportUpdateRun({ status: 'BLOCKED', stage: currentStage, errorCode: 'PRE_EXISTING_INSTANCE_DRIFT', errorMessage: 'Pre-existing source/instance drift requires review before updating.', interventionRequired: true, maintenanceEnabled: false, syncMarkerActive: false, checkedInstances, diagnostics: updateDiagnostics });
    return;
  }
  if (preExistingTargetOnly) log(`${preExistingTargetOnly} target-only file(s) will remain untouched; mutation sync has no --delete.`);
  log('Pre-update source/instance conflicts are clear; only checksum differences from the shared source are eligible for sync.');
  currentStage = 'PREFLIGHT';
  await reportUpdateRun({ stage: currentStage, checkedInstances, publicBuildId: latestBuildId, installedBuildIdBefore: buildIdBefore, diagnostics: updateDiagnostics });
  verifyPerServerComponents();

  const before = await getMaintenanceSnapshot();
  const previousStatus = before.updateStatus?.status ?? null;
  previousMaintenance = before.maintenance === true;
  if (previousStatus === 'RUNNING' && before.updateStatus?.runId !== UPDATE_RUN_ID) {
    throw new Error(`Previous updater status is still RUNNING (started ${before.updateStatus?.startedAt ?? 'unknown'}); refusing overlapping or uncertain maintenance.`);
  }
  await reportUpdateRun({ stage: currentStage, maintenanceWasEnabled: previousMaintenance, maintenanceEnabled: previousMaintenance, syncMarkerActive: false });
  log(`Previous maintenance state: ${previousMaintenance ? 'enabled' : 'disabled'}.`);

  await setMaintenance(true);
  maintenanceTouched = true;
  await setUpdateStatus('RUNNING');
  log('Website maintenance is enabled.');
  beginSyncMarker();
  await setUpdateStage('WAITING_FOR_MATCHES', { maintenanceWasEnabled: previousMaintenance, maintenanceEnabled: true, syncMarkerActive: true, checkedInstances });
  await waitForMatchDrain();
  await setUpdateStage('IDLE_CHECK', { maintenanceWasEnabled: previousMaintenance, maintenanceEnabled: true, syncMarkerActive: true, checkedInstances });
  await assertInstancesIdle();

  // From here on the shared server files can change; maintenance must stay enabled even on
  // failure so players never join a half-updated server.
  mutationStarted = true;
  await setUpdateStage('STEAMCMD_UPDATE', { maintenanceEnabled: true, syncMarkerActive: true });
  await runProcess(STEAMCMD_BIN, [
    '+force_install_dir', COMMON_DIR,
    '+login', 'anonymous',
    '+app_update', APP_ID, 'validate',
    '+quit',
  ], { cwd: GAME_DIR });
  log('SteamCMD app_update completed once against the shared CS2 installation.');
  const sharedBuildAfter = readCs2Build(GAME_DIR);
  const buildIdAfter = readSharedBuildId();
  log(`Shared CS2 build after SteamCMD: ${sharedBuildAfter ?? 'unknown'} (buildid ${buildIdAfter ?? 'unknown'}).`);
  if (!sharedBuildAfter || !buildIdAfter) throw new Error('Shared CS2 build or Build ID is unavailable; refusing to synchronize instances.');
  if (buildIdAfter !== latestBuildId) throw new Error(`SteamCMD installed Build ID ${buildIdAfter}, expected public Build ID ${latestBuildId}; refusing to synchronize instances.`);
  await setUpdateStage('VERIFY_SHARED_BUILD', { installedBuildIdAfter: buildIdAfter, serverVersionAfter: sharedBuildAfter, publicBuildId: latestBuildId, maintenanceEnabled: true, syncMarkerActive: true });

  const { deep, reasons } = selectSyncMode({
    buildIdBefore,
    buildIdAfter,
    previousStatus,
    forceDeep: FORCE_DEEP_VERIFY || plan.deep || plan.runAppUpdate,
  });
  log(`Synchronization mode: ${deep ? 'checksum-based incremental' : 'quick metadata incremental'}${reasons.length ? ` (${reasons.join('; ')})` : ''}.`);
  if (!deep) throw new Error('A new Steam Build ID requires checksum-based incremental synchronization; refusing a metadata-only sync.');

  await syncInstances({
    servers,
    deep,
    sync: async (server, isDeep) => {
      currentStage = 'SYNCING_INSTANCES';
      recordInstanceCheck({ serverName: server.name, status: 'SYNCING', buildId: buildIdAfter, controlFilesVerified: false, smokeStatus: 'PENDING', checkedAt: new Date().toISOString() });
      await reportUpdateRun({ stage: currentStage, installedBuildIdAfter: buildIdAfter, checkedInstances, maintenanceEnabled: true, syncMarkerActive: true });
      await syncInstanceFromShared(server, isDeep);
    },
    verify: async server => {
      verifyInstanceMatchesShared(server, sharedBuildAfter);
      recordInstanceCheck({ serverName: server.name, status: 'READY', buildId: buildIdAfter, serverVersion: readCs2Build(server.root), controlFilesVerified: true, smokeStatus: 'PENDING', checkedAt: new Date().toISOString() });
      await reportUpdateRun({ stage: 'SYNCING_INSTANCES', installedBuildIdAfter: buildIdAfter, serverVersionAfter: sharedBuildAfter, checkedInstances, maintenanceEnabled: true, syncMarkerActive: true });
    },
    log,
  });
  log(`All ${servers.length} instance roots are synchronized with the shared CS2 build.`);

  currentStage = 'SMOKE_CHECK';
  for (const server of servers) {
    const result = await smokeCheckServer(server);
    recordInstanceCheck({ serverName: server.name, status: 'READY', buildId: buildIdAfter, serverVersion: readCs2Build(server.root), controlFilesVerified: true, smokeStatus: result.status, managerReady: false, gameProcessReady: false, gameProcessPid: null, gameProcessStatus: 'STOPPED', checkedAt: new Date().toISOString() });
    if (result.diagnostics.length) updateDiagnostics.push(...result.diagnostics.map(diagnostic => ({ ...diagnostic, serverName: server.name, message: 'Smoke process passed readiness checks but exited with SIGSEGV after controlled quit.', occurredAt: new Date().toISOString() })));
    await reportUpdateRun({ stage: currentStage, installedBuildIdAfter: buildIdAfter, serverVersionAfter: sharedBuildAfter, checkedInstances, diagnostics: updateDiagnostics, maintenanceEnabled: true, syncMarkerActive: true });
  }
  currentStage = 'VERIFYING_CLUSTER';
  const managerState = await waitForManagers();
  for (const server of servers) {
    const state = managerState.find(item => item.name === server.name);
    recordInstanceCheck({ serverName: server.name, status: 'READY', buildId: buildIdAfter, serverVersion: readCs2Build(server.root), controlFilesVerified: true, smokeStatus: checkedInstances.find(item => item.serverName === server.name)?.smokeStatus, managerReady: state?.managerReady === true, gameProcessReady: state?.gameProcessReady === true, gameProcessPid: state?.gameProcessPid ?? null, gameProcessStatus: state?.gameProcessStatus ?? 'UNKNOWN', checkedAt: new Date().toISOString() });
  }
  await reportUpdateRun({ stage: 'FINALIZING', installedBuildIdAfter: buildIdAfter, serverVersionAfter: sharedBuildAfter, checkedInstances, diagnostics: updateDiagnostics, maintenanceEnabled: true, syncMarkerActive: true, interventionRequired: false });
  const finalStatus = updateDiagnostics.length ? 'UPDATED_WITH_DIAGNOSTICS' : 'UPDATED';

  try {
    persistUpdateState(createSuccessfulState(buildIdAfter, sharedBuildAfter, new Date().toISOString(), finalStatus));
  } catch (stateError) {
    try {
      await setMaintenance(true);
      maintenanceTouched = true;
      log('Could not persist confirmed Build ID state; maintenance was re-enabled while match starts remain blocked.');
    } catch (maintenanceError) {
      log(`Could not re-enable maintenance after state persistence failure: ${maintenanceError instanceof Error ? maintenanceError.message : 'unknown API error'}`);
    }
    throw new Error(`Update checks passed but Build ID state could not be saved: ${stateError instanceof Error ? stateError.message : 'unknown error'}`);
  }

  if (!clearSyncMarker('all three instances passed readiness before maintenance release')) throw new Error('SYNC_MARKER_CLEANUP_FAILED');
  const finalization = await updateRunApi()('/api/server-manager/update-runs/finalize', { method: 'POST', body: { runId: UPDATE_RUN_ID, status: finalStatus } });
  maintenanceTouched = false;
  log(finalStatus === 'UPDATED_WITH_DIAGNOSTICS'
    ? 'All three servers passed build, file, manager, port and plugin readiness; post-quit shutdown SIGSEGV was recorded as a diagnostic. Maintenance released after all checks.'
    : 'All three servers passed build, file, manager, port and plugin readiness. Maintenance released after all checks.');
  if (finalization.maintenanceEnabled === true) log('Maintenance was already enabled before this run and remains enabled.');
}

try {
  if (isAdoptingCurrentState) await adoptCurrentSuccessfulState();
  else await main();
} catch (error) {
  if (shuttingDown) {
    process.exitCode = process.exitCode || 143;
  } else if (isAdoptingCurrentState) {
    const message = error instanceof Error ? error.message : 'Unknown state-adoption failure';
    log(`STATE ADOPTION FAILED: ${message}`);
    process.exitCode = 1;
  } else {
    const message = error instanceof Error ? error.message : 'Unknown CS2 update failure';
    log(`ERROR: ${message}`);
    try { persistAttempt('FAILED', { buildId: readSharedBuildId(), error: message.slice(0, 1000) }); }
    catch (stateError) { log(`Could not persist failed-attempt state: ${stateError instanceof Error ? stateError.message : 'unknown error'}`); }
    if (mutationStarted) {
      try {
        if (!maintenanceTouched) {
          await setMaintenance(true);
          maintenanceTouched = true;
        }
        if (!existsSync(SYNC_MARKER)) beginSyncMarker();
        log('Maintenance and the sync marker remain active after a post-mutation failure.');
      } catch (maintenanceError) {
        log(`Could not confirm safety gates after failure: ${maintenanceError instanceof Error ? maintenanceError.message : 'unknown API error'}`);
      }
    }
    const restored = await restoreMaintenanceIfSafe('pre-flight failure');
    if (UPDATE_RUN_ID) {
      currentStage = 'FAILED';
      try {
        await reportUpdateRun({
          status: 'FAILED',
          stage: currentStage,
          errorCode: 'CS2_UPDATE_FAILED',
          errorMessage: message,
          interventionRequired: mutationStarted || !restored && previousMaintenance,
          maintenanceEnabled: mutationStarted ? true : previousMaintenance,
          syncMarkerActive: mutationStarted && existsSync(SYNC_MARKER),
          checkedInstances,
          diagnostics: updateDiagnostics,
          installedBuildIdBefore: readSharedBuildId(),
        });
      } catch (runStatusError) {
        log(`Could not persist terminal run status: ${runStatusError instanceof Error ? runStatusError.message : 'unknown API error'}`);
      }
    }
    try {
      await setUpdateStatus('FAILED', message);
      log(restored ? 'Failure status was recorded and the previous maintenance state was restored.' : 'Failure status was recorded. Maintenance remains enabled.');
    } catch (statusError) {
      log(`Could not record failure status through the app API: ${statusError instanceof Error ? statusError.message : 'unknown API error'}`);
    }
    process.exitCode = 1;
  }
} finally {
  if (!mutationStarted) clearSyncMarker('update stopped before server mutations');
  if (!shuttingDown) await new Promise(resolve => logFile.end(resolve));
}
