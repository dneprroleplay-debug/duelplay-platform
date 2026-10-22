import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTechnicalEventOutbox } from './technical-event-outbox.mjs';
import { managerHealthSnapshot } from './manager-health.mjs';
import sharp from 'sharp';
import {
  FIRST_TO_10_KILLS,
  buildDuelModeCommands,
  chooseRandomWeapon,
  getBuyZoneRemovalCommands,
  getFirstToTenKillsLeader,
  getFirstToTenKillsWinner,
  getMoneylessEconomyCommands,
  getRuleReapplyDelays,
  isMoneylessMode,
  parseBuyZoneNames,
  resolveEffectiveMode,
  shouldRestartAfterFirstConnect,
} from './mode-policy.mjs';
import {
  buildMapConfigNames,
  buildMapLaunchArgs,
  buildMatchMapConfig,
  parseWorkshopSourceFolder,
  safeMapConfigName,
} from './map-launch.mjs';

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const API = required('DUELPLAY_API_URL').replace(/\/$/, '');
const SECRET = required('DUELPLAY_SERVER_MANAGER_SECRET');
const RESULT_SECRET = required('CS2_RESULT_SECRET');
const GSI_TOKEN = required('CS2_GSI_TOKEN');
const CS2_DIR = process.env.CS2_DIR || '/home/ubuntu/cs2/game';
const CS2_STEAMCMD_DIR = process.env.CS2_STEAMCMD_DIR || '/home/ubuntu/cs2';
const CS2_SCRIPT = join(CS2_DIR, 'cs2.sh');
const CS2_AUTO_UPDATE = !['0', 'false', 'no'].includes(String(process.env.CS2_AUTO_UPDATE ?? 'true').toLowerCase());
const STEAMCMD_BIN = process.env.STEAMCMD_BIN || 'steamcmd';
const CS2_APP_ID = Number(process.env.CS2_APP_ID || 730);
const HOST = process.env.CS2_PUBLIC_HOST || '127.0.0.1';
const PORT = Number(process.env.CS2_PORT || 27015);
const SERVER_ID = process.env.DUELPLAY_SERVER_ID || 'cs2-1';
if (!/^cs2-[1-9]\d*$/.test(SERVER_ID)) throw new Error('DUELPLAY_SERVER_ID must use the cs2-N format');
const MANAGER_PORT = Number(process.env.DUELPLAY_MANAGER_PORT || 3010);
const READY_DELAY_MS = Number(process.env.CS2_READY_DELAY_MS || 20000);
const POLL_MS = 2000;
const HEARTBEAT_MS = 1000;
const MANAGER_HEARTBEAT_MS = 10000;
const CONNECT_TIMEOUT_MS = Number(process.env.DUELPLAY_CONNECTION_TIMEOUT_MS || 5 * 60 * 1000);
const SERVER_START_TIMEOUT_MS = Number(process.env.DUELPLAY_SERVER_START_TIMEOUT_MS || 2 * 60 * 1000);
const PORT_PROBE_TIMEOUT_MS = Number(process.env.DUELPLAY_PORT_PROBE_TIMEOUT_MS || 1500);
const technicalEventOutbox = createTechnicalEventOutbox({
  apiUrl: API,
  secret: SECRET,
  serverId: SERVER_ID,
  filePath: process.env.DUELPLAY_EVENT_OUTBOX_FILE || join('/home/ubuntu/cs2/instances', SERVER_ID, 'state', 'technical-events.json'),
  onDrop: notice => console.error('[DuelPlay] technical event delivery exhausted retries', JSON.stringify(notice)),
});

function reportTechnicalEvent(event) {
  void technicalEventOutbox.emit(event).catch(() => {});
}

for (const [name, value] of Object.entries({ MANAGER_PORT, PORT, READY_DELAY_MS, CONNECT_TIMEOUT_MS, SERVER_START_TIMEOUT_MS, HEARTBEAT_MS, POLL_MS, PORT_PROBE_TIMEOUT_MS })) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
}
if (!existsSync(CS2_SCRIPT)) throw new Error(`CS2 script not found: ${CS2_SCRIPT}`);
if (!Number.isInteger(CS2_APP_ID) || CS2_APP_ID <= 0) throw new Error('CS2_APP_ID must be a positive integer');

let current = null;
let lastGsiAt = 0;
let resultSent = false;
let serverReadyAt = 0;
let connectedSteamIds = [];
let connectionPhaseCompleted = false;
let duelRulesAppliedAfterConnect = false;
let lastHeartbeatSentAt = 0;
let lastManagerHeartbeatAt = 0;
let readyTimer = null;
let startupDeadlineTimer = null;
let warmupGuardTimer = null;
let moneylessGuardTimer = null;
let buyZoneReportPending = false;
let buyZoneReportBuffer = '';
let buyZoneGuardTimer = null;
const BUY_ZONE_REPORT_SETTLE_MS = 400;
const BUY_ZONE_GUARD_INTERVAL_MS = 3000;
const duelRuleTimers = new Set();
let lastRoundRuleApplyAt = 0;
let shuttingDown = false;
let lastLogFile = "";
let lastLogSize = 0;
let lastRoundWinnerTeam = null;
const observedTeams = new Map();
let refereeSequence = 0;
let refereeEventChain = Promise.resolve();
let refereeRoundNumber = null;
let refereeRoundPhase = null;
let refereeMapPhase = null;
let refereeObservedPlayers = new Set();
const refereeLastStats = new Map();
const refereeLastRoundStats = new Map();
const refereeLastWeapons = new Map();
let refereeState = {
  version: 1,
  mode: null,
  mapName: null,
  round: 0,
  roundPhase: null,
  mapPhase: null,
  score: { CT: 0, T: 0 },
  players: {}
};


const AVATAR_CACHE_DIR = '/home/ubuntu/duelplay-avatar-cache';
const AVATAR_MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const AVATAR_MAX_PNG_BYTES = 512 * 1024;

async function preparePlayerAvatar(steamId, avatarUrl) {
  if (!steamId || !avatarUrl) return null;

  const normalized = canonicalPlayerSteamId(steamId);
  const rawUrl = String(avatarUrl).trim();
  if (!rawUrl) return null;

  const resolvedUrl = rawUrl.startsWith("/")
    ? `${API}${rawUrl}`
    : rawUrl;

  try {
    let sourceBuffer;

    if (rawUrl.startsWith('data:image/')) {
      const comma = rawUrl.indexOf(',');
      if (comma === -1) return null;

      const meta = rawUrl.slice(0, comma);
      const payload = rawUrl.slice(comma + 1);

      sourceBuffer = meta.includes(';base64')
        ? Buffer.from(payload, 'base64')
        : Buffer.from(decodeURIComponent(payload));

      if (sourceBuffer.length > AVATAR_MAX_SOURCE_BYTES) {
        throw new Error('avatar source is too large');
      }
    } else if (/^https?:\/\//i.test(resolvedUrl)) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      try {
        const response = await fetch(resolvedUrl, {
          signal: controller.signal,
          headers: { 'user-agent': 'DuelPlay-CS2-Avatar/1.0' }
        });

        if (!response.ok) throw new Error(`avatar http ${response.status}`);

        const contentLength = Number(response.headers.get('content-length') || 0);
        if (contentLength > AVATAR_MAX_SOURCE_BYTES) {
          throw new Error('avatar source is too large');
        }

        sourceBuffer = Buffer.from(await response.arrayBuffer());
      } finally {
        clearTimeout(timeout);
      }
    } else {
      throw new Error('unsupported avatar source');
    }

    if (!sourceBuffer?.length || sourceBuffer.length > AVATAR_MAX_SOURCE_BYTES) {
      throw new Error('invalid avatar source');
    }

    const png = await sharp(sourceBuffer)
      .resize(64, 64, { fit: 'cover', position: 'centre' })
      .png({ compressionLevel: 9 })
      .toBuffer();

    if (!png.length || png.length > AVATAR_MAX_PNG_BYTES) {
      throw new Error('converted avatar is too large');
    }

    mkdirSync(AVATAR_CACHE_DIR, { recursive: true });

    const filePath = join(AVATAR_CACHE_DIR, `${normalized}.png`);
    writeFileSync(filePath, png);

    return filePath;
  } catch (error) {
    console.error(`[DuelPlay] avatar prepare failed ${normalized}:`, error);
    return null;
  }
}

async function api(path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('x-duelplay-server-secret', SECRET);
  headers.set('content-type', 'application/json');
  const response = await fetch(`${API}${path}`, { ...init, headers });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(`${response.status}: ${data.error || text}`);
  return data;
}

function ensureMetamodGameInfo() {
  const gameInfoPath = join(CS2_DIR, 'csgo', 'gameinfo.gi');

  if (!existsSync(gameInfoPath)) {
    throw new Error(`CS2 gameinfo.gi not found: ${gameInfoPath}`);
  }

  let content = readFileSync(gameInfoPath, 'utf8');
  const metamodPattern = /^\s*Game\s+csgo\/addons\/metamod\s*$/m;

  if (metamodPattern.test(content)) {
    console.log('[DuelPlay] Metamod gameinfo entry already present');
    return;
  }

  const searchPaths = content.match(/SearchPaths\s*\{/);

  if (!searchPaths) {
    throw new Error(`Could not find SearchPaths block in ${gameInfoPath}`);
  }

  const insertAt = searchPaths.index + searchPaths[0].length;
  content =
    content.slice(0, insertAt) +
    `\n    Game    csgo/addons/metamod` +
    content.slice(insertAt);

  writeFileSync(gameInfoPath, content);
  console.log('[DuelPlay] Restored Metamod gameinfo entry');
}

function updateCs2Server() {
  if (CS2_AUTO_UPDATE) {
    console.log(`[DuelPlay] updating CS2 dedicated server via ${STEAMCMD_BIN} (app ${CS2_APP_ID})`);
    const result = spawnSync(
      STEAMCMD_BIN,
      ['+force_install_dir', CS2_STEAMCMD_DIR, '+login', 'anonymous', '+app_update', String(CS2_APP_ID), 'validate', '+quit'],
      { stdio: 'inherit', cwd: CS2_DIR, env: process.env }
    );

    if (result.error) {
      throw new Error(`SteamCMD update failed to start: ${result.error.message}. Set STEAMCMD_BIN or CS2_AUTO_UPDATE=false if SteamCMD is installed elsewhere.`);
    }

    if (result.status !== 0) {
      throw new Error(`SteamCMD CS2 update failed with exit code ${result.status}`);
    }
  } else {
    console.log('[DuelPlay] CS2_AUTO_UPDATE=false; using the centrally updated shared CS2 installation');
  }

  ensureMetamodGameInfo();
  if (CS2_AUTO_UPDATE) console.log('[DuelPlay] CS2 dedicated server update/validation completed');
}

function writeConfigs() {
  // Generated mode cfgs are loaded verbatim by `+exec duelplay_<mode>` at server
  // launch. They must track the current mode policy, otherwise an already
  // provisioned server keeps a stale (and previously invalid) rule set forever.
  const writeIfChanged = (filePath, contents) => {
    if (existsSync(filePath) && readFileSync(filePath, 'utf8') === contents) return;
    writeFileSync(filePath, contents);
  };
  const cfgDir = join(CS2_DIR, 'csgo', 'cfg');
  mkdirSync(cfgDir, { recursive: true });
  const serverCfgPath = join(cfgDir, 'gamemode_competitive_server.cfg');
  const serverCfgTemplate = [
    '// DuelPlay managed CS2 1v1 server',
    'bot_quota 0',
    'bot_quota_mode normal',
    'bot_kick',
    'mp_autoteambalance 0',
    'mp_limitteams 0',
    'sv_visiblemaxplayers 2',
    'mp_freezetime 5',
    'mp_roundtime 2',
    'mp_roundtime_defuse 2',
    'mp_roundtime_hostage 2',
    'mp_buytime 15',
    'mp_buy_during_immunity 1',
    'mp_respawn_immunitytime 5',
    'mp_buy_anywhere 1',
    'mp_buy_allow_guns 255',
    'mp_buy_allow_grenades 1',
    'mp_weapons_allow_map_placed 1',
    'mp_warmup_end',
    'mp_warmup_online_enabled 0',
    'mp_warmuptime 0',
    'mp_match_can_clinch 1',
    'mp_match_end_restart 0',
    'log on',
    'sv_logecho 1',
    'sv_logfile 1',
    'mp_logmessages 1',
    ''
  ].join('\n');
  if (!existsSync(serverCfgPath)) {
    writeFileSync(serverCfgPath, serverCfgTemplate);
  } else {
    const currentServerCfg = readFileSync(serverCfgPath, 'utf8');
    const nextServerCfg = /^mp_buytime\s+/m.test(currentServerCfg)
      ? currentServerCfg.replace(/^mp_buytime\s+.*$/m, 'mp_buytime 15')
      : `${currentServerCfg}${currentServerCfg.endsWith('\n') ? '' : '\n'}mp_buytime 15\n`;
    writeIfChanged(serverCfgPath, nextServerCfg);
  }
  for (const [name, mode, modifier] of [
    ['duelplay_awp.cfg', 'AWP_ONLY', 'AWP_ONLY'],
    ['duelplay_grenade.cfg', 'GRENADE_ONLY', 'GRENADE_ONLY'],
    ['duelplay_deagle.cfg', 'DEAGLE_ONLY', 'DEAGLE_ONLY'],
    ['duelplay_knife.cfg', 'KNIFE_ONLY', 'KNIFE_ONLY'],
    ['duelplay_headshot.cfg', 'HEADSHOT_ONLY', 'HEADSHOT_ONLY'],
    ['duelplay_first_to_10.cfg', 'FIRST_TO_10', null],
  ]) {
    const rules = buildDuelModeCommands(mode, modifier);
    writeIfChanged(join(cfgDir, name), [`// DuelPlay ${mode} rules`, ...rules].join('\n') + '\n');
  }
  const gsi = `"DuelPlay"\n{\n  "uri" "http://127.0.0.1:${MANAGER_PORT}/gsi"\n  "timeout" "1.0"\n  "buffer" "0.0"\n  "throttle" "0.0"\n  "heartbeat" "1.0"\n  "auth"\n  {\n    "token" "${GSI_TOKEN}"\n  }\n  "output"\n  {\n    "precision_time" "3"\n    "precision_position" "1"\n    "precision_vector" "3"\n  }\n  "data"\n  {\n    "provider" "1"\n    "map" "1"\n    "map_round_wins" "1"\n    "round" "1"\n    "player_id" "1"\n    "player_state" "1"\n    "player_match_stats" "1"\n    "player_weapons" "1"\n    "allplayers" "1"\n    "allplayers_id" "1"\n    "allplayers_state" "1"\n    "allplayers_match_stats" "1"\n    "allplayers_weapons" "1"\n    "allplayers_position" "1"\n    "allgrenades" "1"\n    "phase_countdowns" "1"\n  }\n}\n`;
  const gsiPath = join(cfgDir, 'gamestate_integration_duelplay.cfg');
  if (!existsSync(gsiPath) || readFileSync(gsiPath, 'utf8') !== gsi) writeFileSync(gsiPath, gsi);
}

function command(text) {
  const child = current?.process;
  if (!child || child.killed || child.exitCode !== null || child.stdin.destroyed) return false;
  try { child.stdin.write(`${text}\n`); return true; } catch { return false; }
}

function syncPlayerNickname(steamId) {
  if (!current || !steamId) return;

  const normalized = canonicalPlayerSteamId(steamId);
  const entries = [
    [current.playerOneSteamId, current.playerOneNickname],
    [current.playerTwoSteamId, current.playerTwoNickname]
  ];

  const match = entries.find(([id]) => canonicalPlayerSteamId(id) === normalized);
  if (!match?.[1]) return;

  const nickname = String(match[1])
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\\"');

  command(`duelplay_set_player_name ${normalized} "${nickname}"`);
  console.log(`[DuelPlay] syncing CS2 nickname ${normalized} -> ${match[1]}`);
}

const syncedAvatarKeys = new Map();

async function syncPlayerAvatar(steamId) {
  if (!current || !steamId) return;

  const normalized = canonicalPlayerSteamId(steamId);
  const entries = [
    [current.playerOneSteamId, current.playerOneAvatarUrl],
    [current.playerTwoSteamId, current.playerTwoAvatarUrl]
  ];

  const match = entries.find(([id]) => canonicalPlayerSteamId(id) === normalized);
  const avatarUrl = match?.[1];
  if (!avatarUrl) return;

  const matchId = current.id;
  const syncKey = `${matchId}:${normalized}`;
  if (syncedAvatarKeys.get(syncKey) === avatarUrl) return;

  const avatarPath = await preparePlayerAvatar(normalized, avatarUrl);
  if (!avatarPath) return;
  if (!current || current.id !== matchId) return;

  if (command(`duelplay_set_player_avatar ${normalized} ${avatarPath}`)) {
    syncedAvatarKeys.set(syncKey, avatarUrl);
    console.log(`[DuelPlay] syncing CS2 avatar ${normalized} -> ${avatarPath}`);
  }
}

function clearCurrentTimers() {
  if (readyTimer) clearTimeout(readyTimer);
  if (startupDeadlineTimer) clearTimeout(startupDeadlineTimer);
  if (warmupGuardTimer) clearInterval(warmupGuardTimer);
  if (moneylessGuardTimer) clearInterval(moneylessGuardTimer);
  if (buyZoneGuardTimer) clearInterval(buyZoneGuardTimer);
  readyTimer = null;
  startupDeadlineTimer = null;
  warmupGuardTimer = null;
  moneylessGuardTimer = null;
  buyZoneGuardTimer = null;
  for (const timer of duelRuleTimers) clearTimeout(timer);
  duelRuleTimers.clear();
}

function scheduleCurrentMatchTask(delay, task) {
  const matchId = current?.id;
  if (!matchId) return null;
  const timer = setTimeout(() => {
    duelRuleTimers.delete(timer);
    if (!current || current.id !== matchId || resultSent) return;
    task();
  }, delay);
  duelRuleTimers.add(timer);
  return timer;
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    let settled = false;
    const finish = (available) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(available);
    };
    socket.once('connect', () => finish(false));
    socket.once('error', () => finish(true));
    socket.setTimeout(PORT_PROBE_TIMEOUT_MS, () => finish(true));
  });
}

function isUdpPortListening(pid, port) {
  if (!pid || !Number.isInteger(port) || port <= 0) return false;
  const portHex = Number(port).toString(16).padStart(4, '0').toUpperCase();
  for (const protocol of ['udp', 'udp6']) {
    try {
      const text = readFileSync(`/proc/${pid}/net/${protocol}`, 'utf8');
      const lines = text.split(/\r?\n/).slice(1);
      if (lines.some((line) => {
        const columns = line.trim().split(/\s+/);
        const localAddress = columns[1] || '';
        const localPort = localAddress.split(':').pop()?.toUpperCase();
        const state = columns[3] || '';
        return localPort === portHex && state === '07';
      })) return true;
    } catch {}
  }
  return false;
}


function scanLatestServerLog() {
  if (!current) return;
  const logDir = join(CS2_DIR, 'csgo', 'logs');
  if (!existsSync(logDir)) return;
  let files = [];
  try {
    files = readdirSync(logDir).filter(name => name.endsWith('.log')).map(name => ({
      name,
      mtime: statSync(join(logDir, name)).mtimeMs
    })).sort((a, b) => b.mtime - a.mtime);
  } catch { return; }
  const latest = files[0];
  if (!latest) return;
  const file = join(logDir, latest.name);
  try {
    const size = statSync(file).size;
    if (latest.name === lastLogFile && size <= lastLogSize) return;
    const text = readFileSync(file, 'utf8');
    const delta = latest.name === lastLogFile ? text.slice(lastLogSize) : text;
    lastLogFile = latest.name;
    lastLogSize = size;
    observeServerLine(delta);
  } catch { /* log may be rotated while reading */ }
}

function applyDuelRules(mode, weaponModifier) {
  if (resolveEffectiveMode(mode, weaponModifier) === 'RANDOM_WEAPON' && current && !current.randomWeapon) {
    current.randomWeapon = chooseRandomWeapon();
  }
  for (const rule of buildDuelModeCommands(mode, weaponModifier, current?.randomWeapon)) command(rule);
  enforceMoneylessEconomy();
}

// A workshop map restores its own money and buy values on every spawn (it hands
// out $60000 and reopens the shop), so a money-less mode has to be closed again
// after the map logic ran. mp_maxmoney 0 clamps the granted balance back to $0.
function enforceMoneylessEconomy() {
  if (!current || resultSent) return;
  if (!isMoneylessMode(current.mode, current.weaponModifier)) return;
  for (const rule of getMoneylessEconomyCommands()) command(rule);
}

// Removing the buy zone makes CS2 answer with the stock "You left the buy zone"
// message instead of opening the shop, like a knife-only map without a buy zone.
// The zone is a map entity with a map specific name (fy_snow ships
// "434_buyzone_434"), so the name is discovered from the CS2 entity report
// instead of being guessed.
function closeMoneylessShop() {
  if (!current || resultSent) return;
  if (!isMoneylessMode(current.mode, current.weaponModifier)) return;
  enforceMoneylessEconomy();
  for (const rule of getBuyZoneRemovalCommands()) command(rule);
  requestBuyZoneRemoval();
}

// CS2 exposes "ent_list_report [-a] [-class name] [-name name] [-pos]". The
// report is printed to the console, so the manager reads it back from the
// server output and removes every buy zone it finds.
function requestBuyZoneRemoval() {
  if (!current || resultSent) return;
  if (!isMoneylessMode(current.mode, current.weaponModifier)) return;
  if (buyZoneReportPending) return;
  buyZoneReportPending = true;
  buyZoneReportBuffer = '';
  command('ent_list_report -class func_buyzone');
  setTimeout(() => {
    if (!buyZoneReportPending) return;
    buyZoneReportPending = false;
    const names = parseBuyZoneNames(buyZoneReportBuffer);
    buyZoneReportBuffer = '';
    for (const name of names) command(`ent_fire ${name} kill`);
    if (names.length) console.log(`[DuelPlay] removed ${names.length} buy zone(s): ${names.join(', ')}`);
  }, BUY_ZONE_REPORT_SETTLE_MS);
}

function parseBuyZoneNamesFromBuffer(buffer) {
  return parseBuyZoneNames(buffer);
}
function writeMatchMapConfig(mapNames, mode, weaponModifier, randomWeapon = null) {
  const mapCfgDir = join(CS2_DIR, 'csgo', 'cfg', 'maps');
  mkdirSync(mapCfgDir, { recursive: true });
  const content = buildMatchMapConfig(mode, weaponModifier, randomWeapon);
  for (const name of mapNames) {
    const safe = safeMapConfigName(name);
    if (!safe) continue;
    writeFileSync(join(mapCfgDir, `${safe}.cfg`), content);
  }
}

// The Workshop item's publish_data.txt exposes a source_folder, but it can differ
// from the internal BSP name CS2 actually loads (3383710636 -> testmap vs
// colosseummaphure). Use it only as an extra cfg-name fallback; the verified real
// name comes from WORKSHOP_MAP_SOURCE_FOLDERS.
function resolveWorkshopSourceFolder(workshopId) {
  const id = String(workshopId || '').trim();
  if (!id) return null;
  const candidates = [
    join(CS2_DIR, 'bin', 'linuxsteamrt64', 'steamapps', 'workshop', 'content', '730', id, 'publish_data.txt'),
    join(CS2_DIR, 'csgo', 'addons', 'workshop', id, 'publish_data.txt'),
  ];
  for (const filePath of candidates) {
    try {
      if (!existsSync(filePath)) continue;
      const sourceFolder = parseWorkshopSourceFolder(readFileSync(filePath, 'utf8'));
      if (sourceFolder) return sourceFolder;
    } catch { /* ignore unreadable Workshop metadata */ }
  }
  return null;
}

function steam64FromSteam3(value) {
  const match = String(value).match(/\[U:1:(\d+)\]/);
  if (!match) return null;
  return String(76561197960265728n + BigInt(match[1]));
}

function normalizeSteamId(value) {
  const raw = String(value ?? '').trim();

  if (!raw) return null;

  // Steam64
  if (/^\d{17}$/.test(raw)) {
    return raw;
  }

  // Steam3: [U:1:46347130]
  const steam3 = steam64FromSteam3(raw);
  if (steam3) {
    return steam3;
  }

  // Short Steam account ID: 46347130
  if (/^\d+$/.test(raw)) {
    try {
      return String(76561197960265728n + BigInt(raw));
    } catch {}
  }

  return raw;
}

function canonicalPlayerSteamId(value) {
  if (!current) return null;

  const normalized = normalizeSteamId(value);
  if (!normalized) return null;

  const p1 = normalizeSteamId(current.playerOneSteamId);
  const p2 = normalizeSteamId(current.playerTwoSteamId);

  if (normalized === p1) return p1;
  if (normalized === p2) return p2;

  return null;
}


function finalizePlayerLoadoutAfterConnect() {
  if (!current || !serverReadyAt || duelRulesAppliedAfterConnect) return;
  duelRulesAppliedAfterConnect = true;
  const restartAfterConnect = shouldRestartAfterFirstConnect(current.mode, current.weaponModifier);
  applyDuelRules(current.mode, current.weaponModifier);
  command('mp_warmup_end');

  // Classic and HEADSHOT_ONLY must not restart the round again after the player
  // connects. They use the normal arsenal, and a replay of the workshop restart
  // only delays the first real round. Modes with a forced default weapon still
  // restart once so that weapon reaches an already-spawned player.
  if (restartAfterConnect) command('mp_restartgame 1');

  for (const delay of getRuleReapplyDelays('PLAYER_CONNECTED')) {
    scheduleCurrentMatchTask(delay, () => {
      applyDuelRules(current.mode, current.weaponModifier);
      command('mp_warmup_end');
    });
  }
}

function setDuelPlayerNames() {
  if (!current || connectedSteamIds.length < 2) return;

  const players = [
    { steamId: current.playerOneSteamId, nickname: current.playerOneNickname },
    { steamId: current.playerTwoSteamId, nickname: current.playerTwoNickname },
  ];

  for (const player of players) {
    const steamId = String(player.steamId || '').trim();
    const nickname = String(player.nickname || '').trim();

    if (!steamId || !nickname) continue;

    const safeNickname = nickname
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"');

    command(`duelplay_set_player_name ${steamId} "${safeNickname}"`);
  }
}

function observeServerLine(text) {
  if (!current || resultSent) return;

  // CS2 logs an authenticated Steam Net connection before warmup ends.
  // Use this for immediate 1/2 detection instead of waiting for a team line.
  // Workshop maps can initialize their own match cvars around Match_Start.
  // Re-assert DuelPlay rules immediately so the first freeze is exactly 5 seconds
  // and the 30-second buy window is active before players can buy.
  // The Remastered workshop map starts its real freeze immediately after
  // Game_Commencing and can restore mp_freezetime/mp_buytime before Match_Start.
  // Apply DuelPlay rules synchronously here, before the freeze is created.
  if (/World triggered \"Game_Commencing\"/i.test(text)) {
    if (current && !resultSent) {
      applyDuelRules(current.mode, current.weaponModifier);
      closeMoneylessShop();

      // Some Workshop maps run their own point_servercommand on the first spawn /
      // Game_Commencing. That can restore map money/buytime after DuelPlay's
      // initial rules, giving players $60000 and an 82-second buy window. Restart
      // once after that map logic so the first real round spawns with the mode's
      // mp_startmoney and mp_buytime values instead of the map's values.
      if (current.workshopId && !current.workshopRestartScheduled) {
        current.workshopRestartScheduled = true;
        scheduleCurrentMatchTask(1500, () => {
          applyDuelRules(current.mode, current.weaponModifier);
          command('mp_restartgame 1');
          for (const delay of [1500, 3000]) {
            scheduleCurrentMatchTask(delay, () => {
              applyDuelRules(current.mode, current.weaponModifier);
            });
          }
        });
      }
    }
    for (const delay of getRuleReapplyDelays('GAME_COMMENCING')) {
      scheduleCurrentMatchTask(delay, () => {
        applyDuelRules(current.mode, current.weaponModifier);
      });
    }
  }

  if (/World triggered \"Match_Start\"/i.test(text)) {
    for (const delay of getRuleReapplyDelays('MATCH_START')) {
      scheduleCurrentMatchTask(delay, () => {
        applyDuelRules(current.mode, current.weaponModifier);
      });
    }
  }

  if (/World triggered \"Round_Start\"/i.test(text)) {
    const now = Date.now();
    // The map restores money and the buy zone while the round starts, so the
    // money-less closure has to run again immediately, not only on the delayed
    // rule re-apply.
    closeMoneylessShop();
    if (now - lastRoundRuleApplyAt > 1500) {
      lastRoundRuleApplyAt = now;
      for (const delay of getRuleReapplyDelays('ROUND_START')) {
        scheduleCurrentMatchTask(delay, () => {
          applyDuelRules(current.mode, current.weaponModifier);
        });
      }
    }
  }

  // A workshop map runs its own spawn command on every round restart: it hands
  // out $60000 and reopens the buy zone. Closing the economy right after that
  // restart keeps the money-less modes at $0 without a shop.
  if (/World triggered \"Restart_Round/i.test(text)) {
    closeMoneylessShop();
  }

  const steamNetLine = text.match(
    /Accepting Steam Net connection.*?steamid:(\d{17})/i
  );

  if (steamNetLine) {
    const steam64 = normalizeSteamId(steamNetLine[1]);
    const playerSteamId = canonicalPlayerSteamId(steam64);

    if (
      playerSteamId &&
      !connectedSteamIds.includes(playerSteamId)
    ) {
      connectedSteamIds.push(playerSteamId);
      console.log(
        `[DuelPlay] Steam Net player ${playerSteamId} connected (${connectedSteamIds.length}/2)`
      );
      syncPlayerNickname(playerSteamId);
      setTimeout(() => syncPlayerNickname(playerSteamId), 500);
      setTimeout(() => syncPlayerNickname(playerSteamId), 1500);
      void syncPlayerAvatar(playerSteamId);
      setTimeout(() => { void syncPlayerAvatar(playerSteamId); }, 1000);
      setTimeout(() => { void syncPlayerAvatar(playerSteamId); }, 3000);

      // Force the next manager tick to send the new count immediately.
      lastHeartbeatSentAt = 0;
      if (connectedSteamIds.length >= 2) {
        connectionPhaseCompleted = true;
        setDuelPlayerNames();
      }
      if (current) {
        finalizePlayerLoadoutAfterConnect();
        closeMoneylessShop();
      }
    }
  }

  const teamLine = text.match(/<\d+><(\[U:1:\d+\])><(CT|TERRORIST)>/i);
  if (teamLine) {
    const steam64 = normalizeSteamId(teamLine[1]);
    const playerSteamId = canonicalPlayerSteamId(steam64);

    if (playerSteamId) {
      if (!connectedSteamIds.includes(playerSteamId)) {
        connectedSteamIds.push(playerSteamId);
      }

      observedTeams.set(
        playerSteamId,
        teamLine[2].toUpperCase() === 'TERRORIST' ? 'T' : 'CT'
      );

      if (connectedSteamIds.length >= 2) {
        connectionPhaseCompleted = true;
        setDuelPlayerNames();
      }

      console.log(
        `[DuelPlay] server log player ${playerSteamId} connected (${connectedSteamIds.length}/2)`
      );
      void syncPlayerAvatar(playerSteamId);
      if (current) {
        finalizePlayerLoadoutAfterConnect();
        closeMoneylessShop();
      }
    }
  }

  const clinch = text.match(/SFUI_Notice_(CTs|Ts)_Clinched_Match/i);
  const roundWin = text.match(/Team\s+"(CT|TERRORIST)"\s+triggered\s+"SFUI_Notice_(?:CTs|Terrorists)_Win"/i);
  if (roundWin) {
    lastRoundWinnerTeam = roundWin[1].toUpperCase() === 'TERRORIST' ? 'T' : 'CT';
  }

  const gameOver = text.match(/Game Over:.*?score\s+(\d+)[:](\d+)/i);
  const notice = text.match(/Team\s+"(CT|TERRORIST)"\s+triggered\s+"SFUI_Notice_(?:CTs|Terrorists)_Clinched_Match"/i);
  if (!clinch && !gameOver && !notice) return;

  let winnerTeam = notice?.[1]?.toUpperCase() === 'TERRORIST' ? 'T' : notice?.[1]?.toUpperCase() === 'CT' ? 'CT' : clinch?.[1]?.toUpperCase() === 'CTS' ? 'CT' : clinch?.[1]?.toUpperCase() === 'TS' ? 'T' : null;
  if (!winnerTeam && gameOver) {
    const a = Number(gameOver[1]);
    const b = Number(gameOver[2]);
    // Game Over's team order is not guaranteed in every build, so use a prior clinch notice when possible.
    if (a !== b) winnerTeam = null;
  }
  if (winnerTeam) {
    const winner = [...observedTeams.entries()].find(([, team]) => team === winnerTeam)?.[0];
    if (winner) void reportWinner(winner, `server log match clinched by ${winnerTeam}`);
  }
}

async function claimAndStart(match) {
  if (current) return;
  const claimed = await api('/api/server-manager/claim', {
    method: 'POST',
    body: JSON.stringify({ matchId: match.id, serverName: SERVER_ID, host: HOST, port: PORT })
  });
  const runtimeHost = claimed.host || HOST;
  const runtimePort = Number(claimed.port || PORT);
  const mode = claimed.mode || match.mode || 'SOLO_1V1';
  const weaponModifier = claimed.weaponModifier || match.weaponModifier || null;
  const randomWeapon = resolveEffectiveMode(mode, weaponModifier) === 'RANDOM_WEAPON' ? chooseRandomWeapon() : null;
  const workshopId = claimed.workshopId ? String(claimed.workshopId).trim() : '';
  const workshopSourceFolder = resolveWorkshopSourceFolder(workshopId);
  const firstToTen = resolveEffectiveMode(mode, weaponModifier) === 'FIRST_TO_10';
  const mapConfigNames = buildMapConfigNames(match.mapName, workshopId, workshopSourceFolder);
  writeMatchMapConfig(mapConfigNames, mode, weaponModifier, randomWeapon);
  const mapLaunchArgs = buildMapLaunchArgs(match.mapName, workshopId);
  const args = [
    '-dedicated', '-console', '-usercon', '-port', String(runtimePort), '-maxplayers', '2',
    '+game_type', '0', '+game_mode', '1', ...mapLaunchArgs,
    '+sv_lan', '0', '+sv_cheats', '0', '+sv_visiblemaxplayers', '2', '+bot_quota', '0', '+bot_quota_mode', 'normal',
    '+mp_autoteambalance', '0', '+mp_limitteams', '0', '+mp_freezetime', '5', '+mp_roundtime', '2', '+mp_roundtime_defuse', '2', '+mp_roundtime_hostage', '2', '+mp_buytime', '15', '+mp_buy_during_immunity', '1', '+mp_respawn_immunitytime', '5', '+mp_buy_anywhere', '1', '+mp_buy_allow_guns', '255', '+mp_buy_allow_grenades', '1', '+mp_weapons_allow_pistols', '-1', '+mp_weapons_allow_smgs', '-1', '+mp_weapons_allow_rifles', '-1', '+mp_weapons_allow_heavy', '-1', '+mp_weapons_allow_zeus', '1', '+mp_weapons_allow_map_placed', '1', '+mp_require_gun_use_to_acquire', '0', '+sv_allow_ground_weapon_pickup', '1', '+mp_death_drop_gun', '1', '+mp_warmup_online_enabled', '0', '+mp_warmuptime', '0', '+mp_warmup_pausetimer', '0', '+mp_warmup_end', '+mp_maxrounds', firstToTen ? '19' : '13', '+mp_match_can_clinch', firstToTen ? '0' : '1', '+mp_halftime', '0', '+mp_match_end_restart', '0',
    ...(weaponModifier === 'GRENADE_ONLY' || mode === 'GRENADE_ONLY' ? ['+exec', 'duelplay_grenade'] : []),
    ...(weaponModifier === 'AWP_ONLY' || mode === 'AWP_ONLY' ? ['+exec', 'duelplay_awp'] : []),
    ...(weaponModifier === 'DEAGLE_ONLY' || mode === 'DEAGLE_ONLY' ? ['+exec', 'duelplay_deagle'] : []),
    ...(weaponModifier === 'KNIFE_ONLY' || mode === 'KNIFE_ONLY' ? ['+exec', 'duelplay_knife'] : []),
    ...(weaponModifier === 'HEADSHOT_ONLY' || mode === 'HEADSHOT_ONLY' ? ['+exec', 'duelplay_headshot'] : []),
    ...(mode === 'FIRST_TO_10' ? ['+exec', 'duelplay_first_to_10'] : [])
  ];
  reportTechnicalEvent({ source: 'server-manager', category: 'match.server-assigned', severity: 'INFO', message: 'Manager claimed a match server.', matchId: match.id, correlationId: match.id, details: { serverId: SERVER_ID, port: runtimePort } });
  const portAvailable = await isPortAvailable(runtimePort);
  if (!portAvailable) {
    await api(`/api/matches/${match.id}/server`, {
      method: 'POST',
      body: JSON.stringify({ action: 'failed', serverId: claimed.serverId })
    });
    throw new Error(`CS2 port ${runtimePort} is already in use`);
  }

  console.log(`[DuelPlay] starting ${match.id} on ${runtimeHost}:${runtimePort}${workshopId ? ` workshop=${workshopId}` : ''}`);
  const child = spawn(CS2_SCRIPT, args, { cwd: CS2_DIR, stdio: 'pipe', env: process.env });
  reportTechnicalEvent({ source: 'cs2', category: 'process.starting', severity: 'INFO', message: 'CS2 process start requested.', matchId: match.id, correlationId: match.id, details: { pid: child.pid ?? null, port: runtimePort } });
  current = {
    id: match.id,
    serverId: claimed.serverId,
    playerOneSteamId: claimed.playerOneSteamId,
    playerTwoSteamId: claimed.playerTwoSteamId,
    playerOneNickname: claimed.playerOneNickname,
    playerTwoNickname: claimed.playerTwoNickname,
    playerOneAvatarUrl: claimed.playerOneAvatarUrl ?? null,
    playerTwoAvatarUrl: claimed.playerTwoAvatarUrl ?? null,
    mapName: match.mapName || 'Dust2',
    workshopId,
    workshopRestartScheduled: false,
    mode,
    weaponModifier,
    randomWeapon,
    host: runtimeHost,
    port: runtimePort,
    process: child,
    startedAt: Date.now(),
    startRequestedAt: Date.now()
  };
  resultSent = false;
  observedTeams.clear();
  lastRoundWinnerTeam = null;
  lastGsiAt = 0;
  lastLogFile = '';
  lastLogSize = 0;
  serverReadyAt = 0;
  connectedSteamIds = [];
  connectionPhaseCompleted = false;
  duelRulesAppliedAfterConnect = false;
  lastHeartbeatSentAt = 0;
  lastRoundRuleApplyAt = 0;
  syncedAvatarKeys.clear();
  resetRefereeState();

  // A workshop map keeps restoring its money and buy zone while the match runs,
  // so a money-less mode is closed continuously. mp_maxmoney 0 clamps the money
  // the map hands out back to $0, and the shop stays closed for the whole match.
  if (isMoneylessMode(mode, weaponModifier)) {
    if (moneylessGuardTimer) clearInterval(moneylessGuardTimer);
    moneylessGuardTimer = setInterval(() => enforceMoneylessEconomy(), 500);
    if (buyZoneGuardTimer) clearInterval(buyZoneGuardTimer);
    buyZoneGuardTimer = setInterval(() => requestBuyZoneRemoval(), BUY_ZONE_GUARD_INTERVAL_MS);
  }

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    process.stdout.write(`[CS2] ${text}`);
    if (buyZoneReportPending) buyZoneReportBuffer += text;
    observeServerLine(text);
    if (/SV:\s+2 player server started/i.test(text) || /GC Connection established|activated session on GC/i.test(text)) {
      setTimeout(() => {
        command('bot_kick');
        command('bot_quota 0');
        command('bot_quota_mode normal');
        command('mp_autoteambalance 0');
        command('mp_limitteams 0');
        command('sv_visiblemaxplayers 2');
      command('log on');
      command('sv_logecho 1');
      command('sv_logfile 1');
      command('mp_logmessages 1');
      }, 1500);
    }
  });
  child.stderr.on('data', (chunk) => process.stderr.write(`[CS2:ERR] ${chunk}`));
  child.on('error', async (error) => {
    console.error('[DuelPlay] CS2 process error', error);
    const failed = current;
    reportTechnicalEvent({ source: 'cs2', category: 'process.start-failed', severity: 'CRITICAL', message: 'CS2 process failed to start.', matchId: failed?.id ?? match.id, correlationId: failed?.id ?? match.id, details: { errorCode: error.code ?? null, syscall: error.syscall ?? null } });
    if (!failed) return;
    try {
      await api(`/api/matches/${failed.id}/server`, { method: 'POST', body: JSON.stringify({ action: 'failed', serverId: failed.serverId }) });
    } catch (reportError) {
      console.error('[DuelPlay] failed to report CS2 process error', reportError);
    }
  });
  child.on('exit', async (code, signal) => {
    clearCurrentTimers();
    const finished = current;
    current = null;
    if (!finished) return;
    console.log(`[DuelPlay] CS2 exited code=${code} signal=${signal}`);
    reportTechnicalEvent({ source: 'cs2', category: signal ? 'process.crashed' : 'process.stopped', severity: signal || (code !== 0 && code !== null) ? 'CRITICAL' : 'INFO', message: signal ? `CS2 exited after signal ${signal}.` : `CS2 process exited with code ${code}.`, matchId: finished.id, correlationId: finished.id, result: signal ? `signal:${signal}` : `exit:${code}`, details: { pid: finished.process.pid, exitCode: code, signal, wasReady: serverReadyAt > 0 } });
    try {
      await api(`/api/matches/${finished.id}/server`, {
        method: 'POST',
        body: JSON.stringify({ action: 'stopped', serverId: finished.serverId })
      });
    } catch (error) {
      console.error('[DuelPlay] failed to report stop', error);
    }
  });

  const finishStartupAsReady = async () => {
    if (!current || current.id !== match.id || serverReadyAt || shuttingDown) return;
    try {
      command('bot_kick');
      command('bot_quota 0');
      command('bot_quota_mode normal');
      command('mp_autoteambalance 0');
      command('mp_limitteams 0');
      applyDuelRules(current.mode, current.weaponModifier);
      closeMoneylessShop();
          command('mp_warmup_online_enabled 0');
      command('mp_warmuptime 0');
      command('mp_warmup_end');
      command('mp_restartgame 1');
      for (const delay of getRuleReapplyDelays('SERVER_READY')) {
        scheduleCurrentMatchTask(delay, () => {
          applyDuelRules(current.mode, current.weaponModifier);
        });
      }
      command(`mp_match_can_clinch ${firstToTen ? '0' : '1'}`);
      command('mp_match_end_restart 0');
      command('sv_visiblemaxplayers 2');
      command('log on');
      command('sv_logecho 1');
      command('sv_logfile 1');
      command('mp_logmessages 1');
      await api(`/api/matches/${match.id}/server`, {
        method: 'POST',
        body: JSON.stringify({ action: 'ready', serverId: current.serverId, host: runtimeHost, port: runtimePort, processId: current.process.pid })
      });
      serverReadyAt = Date.now();
      reportTechnicalEvent({ source: 'cs2', category: 'process.ready', severity: 'INFO', message: 'CS2 opened its game port and was marked ready by the match flow.', matchId: match.id, correlationId: match.id, details: { pid: current.process.pid, port: runtimePort, map: match.mapName ?? null } });
      connectedSteamIds = [];
      connectionPhaseCompleted = false;
      lastHeartbeatSentAt = 0;
      if (warmupGuardTimer) clearInterval(warmupGuardTimer);
      let warmupGuardTicks = 0;
      warmupGuardTimer = setInterval(() => {
        if (!current || current.id !== match.id || warmupGuardTicks++ >= 12) {
          if (warmupGuardTimer) clearInterval(warmupGuardTimer);
          warmupGuardTimer = null;
          return;
        }
        command('mp_warmup_online_enabled 0');
        command('mp_warmuptime 0');
        command('mp_warmup_pausetimer 0');
        command('mp_warmup_end');
      }, 500);
      if (current?.playerOneSteamId && current?.playerOneNickname) {
        command(`duelplay_set_player_name ${current.playerOneSteamId} "${String(current.playerOneNickname)
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\\"')}"`);
      }

      if (current?.playerTwoSteamId && current?.playerTwoNickname) {
        command(`duelplay_set_player_name ${current.playerTwoSteamId} "${String(current.playerTwoNickname)
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\\"')}"`);
      }

      if (current?.playerOneSteamId && current?.playerOneAvatarUrl) {
        const avatarPath = await preparePlayerAvatar(
          current.playerOneSteamId,
          current.playerOneAvatarUrl
        );
        if (avatarPath) {
          command(`duelplay_set_player_avatar ${current.playerOneSteamId} ${avatarPath}`);
          console.log(`[DuelPlay] syncing CS2 avatar ${current.playerOneSteamId} -> ${avatarPath}`);
        }
      }

      if (current?.playerTwoSteamId && current?.playerTwoAvatarUrl) {
        const avatarPath = await preparePlayerAvatar(
          current.playerTwoSteamId,
          current.playerTwoAvatarUrl
        );
        if (avatarPath) {
          command(`duelplay_set_player_avatar ${current.playerTwoSteamId} ${avatarPath}`);
          console.log(`[DuelPlay] syncing CS2 avatar ${current.playerTwoSteamId} -> ${avatarPath}`);
        }
      }

      console.log(`[DuelPlay] server ready: steam://connect/${runtimeHost}:${runtimePort}`);
    } catch (error) {
      console.error('[DuelPlay] server failed to become ready', error);
      try {
        await api(`/api/matches/${match.id}/server`, { method: 'POST', body: JSON.stringify({ action: 'failed', serverId: current.serverId }) });
      } catch {}
      command('quit');
    }
  };

  readyTimer = setTimeout(() => {
    const poll = setInterval(() => {
      if (!current || current.id !== match.id || serverReadyAt) {
        clearInterval(poll);
        return;
      }
      if (isUdpPortListening(current.process.pid, runtimePort)) {
        clearInterval(poll);
        void finishStartupAsReady();
      }
    }, 1000);
    readyTimer = poll;
    if (isUdpPortListening(current.process.pid, runtimePort)) {
      clearInterval(poll);
      void finishStartupAsReady();
    }
  }, READY_DELAY_MS);

  startupDeadlineTimer = setTimeout(async () => {
    if (!current || current.id !== match.id || serverReadyAt || shuttingDown) return;
    console.log(`[DuelPlay] server startup timeout for ${match.id}, cancelling match`);
    try {
      await api(`/api/matches/${match.id}/server`, {
        method: 'POST',
        body: JSON.stringify({ action: 'failed', serverId: current.serverId })
      });
    } catch (error) {
      console.error('[DuelPlay] startup timeout cancellation failed', error);
    }
    command('quit');
  }, SERVER_START_TIMEOUT_MS);
}

async function reportManagerHealth() {
  if (current || Date.now() - lastManagerHeartbeatAt < MANAGER_HEARTBEAT_MS) return;
  await api('/api/server-manager/health', {
    method: 'POST',
    body: JSON.stringify({ serverName: SERVER_ID, host: HOST, port: PORT, managerPort: MANAGER_PORT, ready: true, managerReady: true, gameProcessReady: false, gameProcessStatus: 'STOPPED', gameProcessPid: null })
  });
  lastManagerHeartbeatAt = Date.now();
}

async function reportWinner(winnerSteamId, reason) {
  if (!current || resultSent) return;

  const canonical =
    canonicalPlayerSteamId(winnerSteamId) ||
    ([
      current.playerOneSteamId,
      current.playerTwoSteamId
    ].includes(winnerSteamId) ? winnerSteamId : null);

  if (!canonical) return;

  resultSent = true;
  console.log(`[DuelPlay] winner ${winnerSteamId} (${reason})`);
  try {
    const response = await fetch(`${API}/api/matches/${current.id}/result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cs2-result-secret': RESULT_SECRET },
      body: JSON.stringify({ winnerSteamId: canonical, source: 'CS2_GSI', reason })
    });
    if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
    const matchId = current.id;
    setTimeout(() => { if (current?.id === matchId) command('quit'); }, 1500);
  } catch (error) {
    resultSent = false;
    console.error('[DuelPlay] result report failed', error);
  }
}

function resetRefereeState() {
  refereeSequence = 0;
  refereeEventChain = Promise.resolve();
  refereeRoundNumber = null;
  refereeRoundPhase = null;
  refereeMapPhase = null;
  refereeObservedPlayers = new Set();
  refereeLastStats.clear();
  refereeLastRoundStats.clear();
  refereeLastWeapons.clear();
  refereeState = { version: 1, mode: current?.mode ?? null, mapName: current?.mapName ?? null, round: 0, roundPhase: null, mapPhase: null, score: { CT: 0, T: 0 }, players: {} };
}

function extractActiveWeapon(player) {
  const weapons = player?.weapons;
  if (!weapons || typeof weapons !== 'object' || Array.isArray(weapons)) return null;
  for (const weapon of Object.values(weapons)) {
    if (!weapon || typeof weapon !== 'object') continue;
    if (String(weapon.state ?? '').toLowerCase() === 'active') {
      return { name: weapon.name ?? null, type: weapon.type ?? null, state: weapon.state ?? null, ammoClip: Number.isFinite(Number(weapon.ammo_clip)) ? Number(weapon.ammo_clip) : null, ammoReserve: Number.isFinite(Number(weapon.ammo_reserve)) ? Number(weapon.ammo_reserve) : null };
    }
  }
  return null;
}

function buildRefereePlayer(steamId, player) {
  const state = player?.state && typeof player.state === 'object' ? player.state : {};
  const stats = player?.match_stats && typeof player.match_stats === 'object' ? player.match_stats : {};
  return { steamId, name: player?.name ?? null, team: player?.team ?? null, activity: player?.activity ?? null, alive: Number(state.health ?? 0) > 0, health: Number.isFinite(Number(state.health)) ? Number(state.health) : null, armor: Number.isFinite(Number(state.armor)) ? Number(state.armor) : null, roundKills: Number(state.round_kills ?? 0), roundKillHeadshots: Number(state.round_killhs ?? 0), roundDamage: Number(state.round_totaldmg ?? 0), kills: Number(stats.kills ?? 0), assists: Number(stats.assists ?? 0), deaths: Number(stats.deaths ?? 0), score: Number(stats.score ?? 0), activeWeapon: extractActiveWeapon(player) };
}

function queueRefereeEvent(type, steamId = null, payload = {}) {
  if (!current || resultSent) return;
  const sequence = ++refereeSequence;
  refereeEventChain = refereeEventChain.then(async () => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await api(`/api/matches/${current.id}/server`, { method: 'POST', body: JSON.stringify({ action: 'referee-event', serverId: current.serverId, sequence, type, steamId, payload }) });
        return;
      } catch (error) {
        if (attempt === 3) { console.error(`[DuelPlay] referee event ${sequence} failed`, error); return; }
        await new Promise(resolve => setTimeout(resolve, 250 * attempt));
      }
    }
  });
}

function observeRefereeState(body) {
  if (!current || resultSent) return;
  const allplayers = body?.allplayers;
  const hasSnapshot = allplayers && typeof allplayers === 'object' && !Array.isArray(allplayers);
  const currentPlayers = new Map();
  if (hasSnapshot) {
    for (const [steamId, rawPlayer] of Object.entries(allplayers)) {
      const canonical = canonicalPlayerSteamId(steamId) || canonicalPlayerSteamId(rawPlayer?.steamid ?? rawPlayer?.steam_id ?? rawPlayer?.id);
      if (!canonical) continue;
      const player = buildRefereePlayer(canonical, rawPlayer);
      currentPlayers.set(canonical, player);
      if (!refereeObservedPlayers.has(canonical)) queueRefereeEvent('PLAYER_CONNECTED', canonical, { source: 'GSI' });
      const previous = refereeLastStats.get(canonical);
      if (previous && (player.kills !== previous.kills || player.deaths !== previous.deaths || player.assists !== previous.assists || player.score !== previous.score)) {
        queueRefereeEvent('PLAYER_STATS_CHANGED', canonical, { killsDelta: player.kills - previous.kills, deathsDelta: player.deaths - previous.deaths, assistsDelta: player.assists - previous.assists, scoreDelta: player.score - previous.score, totals: { kills: player.kills, deaths: player.deaths, assists: player.assists, score: player.score } });
      }
      const previousRound = refereeLastRoundStats.get(canonical);
      if (previousRound && (player.roundKills !== previousRound.roundKills || player.roundKillHeadshots !== previousRound.roundKillHeadshots || player.roundDamage !== previousRound.roundDamage)) {
        queueRefereeEvent('PLAYER_ROUND_STATS_CHANGED', canonical, { roundKills: player.roundKills, roundKillHeadshots: player.roundKillHeadshots, roundDamage: player.roundDamage });
      }
      const weaponJson = JSON.stringify(player.activeWeapon);
      if (refereeLastWeapons.get(canonical) !== weaponJson) queueRefereeEvent('PLAYER_WEAPON_CHANGED', canonical, { weapon: player.activeWeapon });
      refereeLastStats.set(canonical, { kills: player.kills, deaths: player.deaths, assists: player.assists, score: player.score });
      refereeLastRoundStats.set(canonical, { roundKills: player.roundKills, roundKillHeadshots: player.roundKillHeadshots, roundDamage: player.roundDamage });
      refereeLastWeapons.set(canonical, weaponJson);
      if (player.team === 'TERRORIST' || player.team === 'T' || player.team === 'CT') observedTeams.set(canonical, player.team === 'TERRORIST' || player.team === 'T' ? 'T' : 'CT');
    }
    for (const previousId of refereeObservedPlayers) if (!currentPlayers.has(previousId)) queueRefereeEvent('PLAYER_DISCONNECTED', previousId, { source: 'GSI' });
    refereeObservedPlayers = new Set(currentPlayers.keys());
  }

  const map = body?.map && typeof body.map === 'object' ? body.map : {};
  const round = body?.round && typeof body.round === 'object' ? body.round : {};
  const roundNumber = Number.isFinite(Number(map.round)) ? Number(map.round) : null;
  const roundPhase = String(round.phase ?? '').toLowerCase() || null;
  const mapPhase = String(map.phase ?? '').toLowerCase() || null;
  const ctScore = Number(map.team_ct?.score ?? 0);
  const tScore = Number(map.team_t?.score ?? 0);
  if (roundNumber !== null && roundNumber !== refereeRoundNumber) {
    queueRefereeEvent(refereeRoundNumber === null ? 'MATCH_OBSERVED' : 'ROUND_STARTED', null, { round: roundNumber });
    refereeRoundNumber = roundNumber;
  }
  if (roundPhase !== refereeRoundPhase) {
    queueRefereeEvent(roundPhase === 'over' ? 'ROUND_ENDED' : 'MATCH_PHASE_CHANGED', null, { round: roundNumber, phase: roundPhase, winTeam: round.win_team ?? null });
    refereeRoundPhase = roundPhase;
  }
  if (mapPhase !== refereeMapPhase) {
    queueRefereeEvent('MATCH_PHASE_CHANGED', null, { phase: mapPhase });
    refereeMapPhase = mapPhase;
  }
  refereeState = { version: 1, mode: current.mode, mapName: current.mapName, round: roundNumber ?? refereeState.round, roundPhase, mapPhase, score: { CT: Number.isFinite(ctScore) ? ctScore : 0, T: Number.isFinite(tScore) ? tScore : 0 }, players: Object.fromEntries(currentPlayers.entries()), observedAt: new Date().toISOString() };
}

function firstToTenPlayers(body) {
  const players = {};
  const allplayers = body?.allplayers;
  if (!allplayers || typeof allplayers !== 'object' || Array.isArray(allplayers)) return players;
  for (const [steamId, player] of Object.entries(allplayers)) {
    const canonical = canonicalPlayerSteamId(steamId)
      || canonicalPlayerSteamId(player?.steamid ?? player?.steam_id ?? player?.id);
    if (canonical) players[canonical] = player;
  }
  return players;
}

function detectWinner(body) {
  if (!current) return;
  observeRefereeState(body);

  const found = new Set();

  const remember = (value) => {
    const playerSteamId = canonicalPlayerSteamId(value);

    if (playerSteamId) {
      found.add(playerSteamId);
    }
  };

  const allplayers = body?.allplayers;

  if (
    allplayers &&
    typeof allplayers === 'object' &&
    !Array.isArray(allplayers)
  ) {
    for (const [steamId, player] of Object.entries(allplayers)) {
      remember(steamId);

      remember(
        player?.steamid ??
        player?.steam_id ??
        player?.id
      );
    }
  }

  remember(
    body?.player?.steamid ??
    body?.player?.steam_id ??
    body?.player_id?.steamid
  );

  // ?????????? GSI ? ????????? ???.
  for (const playerSteamId of found) {
    if (!connectedSteamIds.includes(playerSteamId)) {
      connectedSteamIds.push(playerSteamId);
    }
  }

  if (connectedSteamIds.length >= 2) {
    connectionPhaseCompleted = true;
  }

  if (connectedSteamIds.length > 0) {
    console.log(
      `[DuelPlay] GSI players ${connectedSteamIds.length}/2: ${connectedSteamIds.join(', ')}`
    );
  }

  // ?????????? ??????? ??????.
  const playerSteamId = canonicalPlayerSteamId(
    body?.player?.steamid ??
    body?.player?.steam_id ??
    body?.player_id?.steamid
  );

  if (playerSteamId) {
    const team = String(body?.player?.team || '');

    if (team === 'CT' || team === 'T') {
      observedTeams.set(playerSteamId, team);
    }
  }

  if (resultSent) return;

  const map = body?.map;
  const firstToTen = resolveEffectiveMode(current.mode, current.weaponModifier) === 'FIRST_TO_10';
  const firstToTenSnapshot = firstToTen ? firstToTenPlayers(body) : {};

  if (firstToTen) {
    const winner = getFirstToTenKillsWinner(firstToTenSnapshot);
    if (winner) {
      void reportWinner(winner, `FIRST_TO_10 reached ${FIRST_TO_10_KILLS} kills`);
      return;
    }
  }

  const phase = String(map?.phase || '').toLowerCase();

  if (!['gameover', 'over'].includes(phase)) return;

  // If the 19-round safety cap is reached before anyone gets 10 kills, award the
  // match to the kill leader instead of falling back to the round score.
  if (firstToTen) {
    const leader = getFirstToTenKillsLeader(firstToTenSnapshot);
    if (leader) {
      void reportWinner(leader, 'FIRST_TO_10 round cap reached; kills leader');
      return;
    }
  }

  const ct = Number(map?.team_ct?.score ?? -1);
  const tt = Number(map?.team_t?.score ?? -1);

  if (ct < 0 || tt < 0 || ct === tt) return;

  const winnerTeam = ct > tt ? 'CT' : 'T';

  const winner = [...observedTeams.entries()]
    .find(([, team]) => team === winnerTeam)?.[0] || null;

  if (winner) {
    void reportWinner(
      winner,
      `GSI gameover score CT=${ct} T=${tt}`
    );
  }
}
createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(managerHealthSnapshot({ serverId: SERVER_ID, gamePort: PORT, managerPort: MANAGER_PORT, current, readyAt: serverReadyAt, lastGsiAt })));
    return;
  }
  if (req.method === 'POST' && req.url === '/gsi') {
    let raw = '';
    req.on('data', chunk => { raw += chunk.toString(); });
    req.on('end', () => {
      try {
        const body = JSON.parse(raw || '{}');
        if (body?.auth?.token !== GSI_TOKEN) { res.writeHead(401); res.end('Unauthorized'); return; }
        lastGsiAt = Date.now();
        detectWinner(body);
        res.writeHead(200); res.end('OK');
      } catch {
        res.writeHead(400); res.end('Bad request');
      }
    });
    return;
  }
  res.writeHead(404); res.end('Not found');
}).listen(MANAGER_PORT, '127.0.0.1', () => {
  console.log(`[DuelPlay] manager listening on 127.0.0.1:${MANAGER_PORT}`);
  reportTechnicalEvent({ source: 'server-manager', category: 'manager.started', severity: 'INFO', message: 'Server manager started and is accepting local requests.', details: { managerPort: MANAGER_PORT } });
  void technicalEventOutbox.flush();
  const retryTimer = setInterval(() => { void technicalEventOutbox.flush(); }, 30_000);
  retryTimer.unref();
});

async function loop() {
  try {
    if (!current) {
      await reportManagerHealth();
      const queue = await api(`/api/server-manager/queue?serverId=${encodeURIComponent(SERVER_ID)}`);
      if (queue.pending) await claimAndStart(queue.pending);
    } else {
      scanLatestServerLog();

      if (Date.now() - lastHeartbeatSentAt >= HEARTBEAT_MS) {
        try {
          await api(`/api/matches/${current.id}/server`, {
            method: 'POST',
            body: JSON.stringify({
              action: 'heartbeat',
              serverId: current.serverId,
              connectedSteamIds,
              connectionPhaseCompleted,
              refereeState
            })
          });

          lastHeartbeatSentAt = Date.now();

          console.log(
            `[DuelPlay] heartbeat: ${connectedSteamIds.length}/2 players connected`
          );
        } catch (error) {
          console.error('[DuelPlay] heartbeat failed', error);
        }
      }
      if (
        serverReadyAt &&
        !connectionPhaseCompleted &&
        Date.now() - serverReadyAt >= CONNECT_TIMEOUT_MS &&
        connectedSteamIds.length < 2
      ) {
        const connected = [...new Set(connectedSteamIds.map(normalizeSteamId).filter((value) => Boolean(value)))];

        if (connected.length === 1) {
          const timedOutMatchId = current.id;
          console.log(`[DuelPlay] connection timeout: ${connected[0]} connected, awarding technical win`);
          try {
            await api(`/api/matches/${timedOutMatchId}/server`, {
              method: 'POST',
              body: JSON.stringify({
                action: 'connection-timeout',
                serverId: current.serverId,
                connectedSteamId: connected[0]
              })
            });
            command('quit');
          } catch (error) {
            console.error('[DuelPlay] technical win API failed', error);
            resultSent = false;
          }
          if (!current || current.id !== timedOutMatchId) return;
        } else {
          console.log('[DuelPlay] connection timeout: nobody connected, refunding stakes');

          try {
            await api(`/api/matches/${current.id}/server`, {
              method: 'POST',
              body: JSON.stringify({
                action: 'failed',
                serverId: current.serverId,
                reason: 'No player connected within 5 minutes' 
              })
            });
          } catch (error) {
            console.error('[DuelPlay] timeout refund failed', error);
          }

          command('quit');
        }
      }

      if (!current) return;
      try {
        const state = await api(`/api/matches/${current.id}`);
        if (['FINISHED', 'CANCELLED'].includes(state.match?.status)) command('quit');
      } catch (error) { console.error('[DuelPlay] state poll failed', error); }
    }
  } catch (error) {
    console.error('[DuelPlay] manager loop error', error);
  }
  setTimeout(loop, POLL_MS);
}

updateCs2Server();
writeConfigs();
void loop();

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearCurrentTimers();
  const active = current;
  if (active) {
    command('quit');
    setTimeout(() => process.exit(0), 15000).unref();
  } else {
    process.exit(0);
  }
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
