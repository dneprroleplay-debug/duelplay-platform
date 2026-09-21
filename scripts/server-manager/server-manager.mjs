import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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
const CS2_SCRIPT = join(CS2_DIR, 'cs2.sh');
const CS2_AUTO_UPDATE = !['0', 'false', 'no'].includes(String(process.env.CS2_AUTO_UPDATE ?? 'true').toLowerCase());
const STEAMCMD_BIN = process.env.STEAMCMD_BIN || 'steamcmd';
const CS2_APP_ID = Number(process.env.CS2_APP_ID || 730);
const HOST = process.env.CS2_PUBLIC_HOST || '127.0.0.1';
const PORT = Number(process.env.CS2_PORT || 27015);
const SERVER_ID = process.env.DUELPLAY_SERVER_ID || 'cs2-1';
const MANAGER_PORT = Number(process.env.DUELPLAY_MANAGER_PORT || 3010);
const READY_DELAY_MS = Number(process.env.CS2_READY_DELAY_MS || 20000);
const POLL_MS = 2000;
const HEARTBEAT_MS = 1000;
const CONNECT_TIMEOUT_MS = Number(process.env.DUELPLAY_CONNECTION_TIMEOUT_MS || 5 * 60 * 1000);
const SERVER_START_TIMEOUT_MS = Number(process.env.DUELPLAY_SERVER_START_TIMEOUT_MS || 2 * 60 * 1000);
const PORT_PROBE_TIMEOUT_MS = Number(process.env.DUELPLAY_PORT_PROBE_TIMEOUT_MS || 1500);

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
let readyTimer = null;
let startupDeadlineTimer = null;
let warmupGuardTimer = null;
let grenadeLoadoutPulseTimer = null;
let lastGrenadeLoadoutPulseAt = 0;
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

function updateCs2Server() {
  if (!CS2_AUTO_UPDATE) {
    console.log('[DuelPlay] CS2_AUTO_UPDATE=false; using the installed CS2 server build');
    return;
  }

  console.log(`[DuelPlay] updating CS2 dedicated server via ${STEAMCMD_BIN} (app ${CS2_APP_ID})`);
  const result = spawnSync(
    STEAMCMD_BIN,
    ['+force_install_dir', CS2_DIR, '+login', 'anonymous', '+app_update', String(CS2_APP_ID), 'validate', '+quit'],
    { stdio: 'inherit', cwd: CS2_DIR, env: process.env }
  );

  if (result.error) {
    throw new Error(`SteamCMD update failed to start: ${result.error.message}. Set STEAMCMD_BIN or CS2_AUTO_UPDATE=false if SteamCMD is installed elsewhere.`);
  }

  if (result.status !== 0) {
    throw new Error(`SteamCMD CS2 update failed with exit code ${result.status}`);
  }

  console.log('[DuelPlay] CS2 dedicated server update/validation completed');
}

function writeConfigs() {
  const cfgDir = join(CS2_DIR, 'csgo', 'cfg');
  mkdirSync(cfgDir, { recursive: true });
  writeFileSync(join(cfgDir, 'gamemode_competitive_server.cfg'), [
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
    'mp_buytime 5',
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
  ].join('\n'));
  writeFileSync(join(cfgDir, 'duelplay_awp.cfg'), [
    '// DuelPlay AWP ONLY rules',
    'mp_freezetime 5',
    'mp_warmup_end',
    'mp_warmup_online_enabled 0',
    'mp_warmuptime 0',
    'mp_buytime 0',
    'mp_buy_anywhere 0',
    'mp_buy_allow_guns 0',
    'mp_buy_allow_grenades 0',
    'mp_weapons_allow_map_placed 0',
    'mp_weapons_allow_pistols 0',
    'mp_weapons_allow_smgs 0',
    'mp_weapons_allow_rifles 0',
    'mp_weapons_allow_heavy 0',
    'mp_weapons_allow_zeus 0',
    'mp_t_default_primary weapon_awp',
    'mp_ct_default_primary weapon_awp',
    'mp_t_default_secondary 0',
    'mp_ct_default_secondary 0',
    'mp_t_default_melee weapon_knife',
    'mp_ct_default_melee weapon_knife',
    'mp_t_default_grenades 0',
    'mp_ct_default_grenades 0',
    'mp_free_armor 2',
    'mp_death_drop_gun 0',
    'mp_death_drop_grenade 0',
    ''
  ].join('\n'));
  writeFileSync(join(cfgDir, 'duelplay_grenade.cfg'), [
    '// DuelPlay GRENADE ONLY rules',
    'mp_freezetime 5',
    'mp_warmup_end',
    'mp_warmup_online_enabled 0',
    'mp_warmuptime 0',
    'mp_buytime 0',
    'mp_buy_anywhere 0',
    'mp_buy_allow_guns 0',
    'mp_buy_allow_grenades 0',
    'mp_weapons_allow_map_placed 0',
    'mp_weapons_allow_pistols 0',
    'mp_weapons_allow_smgs 0',
    'mp_weapons_allow_rifles 0',
    'mp_weapons_allow_heavy 0',
    'mp_weapons_allow_zeus 0',
    'mp_t_default_primary 0',
    'mp_ct_default_primary 0',
    'mp_t_default_secondary 0',
    'mp_ct_default_secondary 0',
    'mp_t_default_melee weapon_knife',
    'mp_ct_default_melee weapon_knife',
    'mp_t_default_grenades 0',
    'mp_ct_default_grenades 0',
    'ammo_grenade_limit_total 12',
    'ammo_grenade_limit_default 3',
    'ammo_grenade_limit_flashbang 3',
    'mp_death_drop_gun 0',
    'mp_death_drop_grenade 0',
    ''
  ].join('\n'));
  writeFileSync(join(cfgDir, 'duelplay_deagle.cfg'), [
    '// DuelPlay DEAGLE ONLY rules', 'mp_freezetime 5', 'mp_roundtime 5', 'mp_roundtime_defuse 5', 'mp_roundtime_hostage 5', 'mp_warmup_end', 'mp_buytime 0', 'mp_buy_anywhere 0',
    'mp_buy_allow_guns 0', 'mp_buy_allow_grenades 0', 'mp_weapons_allow_map_placed 0',
    'mp_weapons_allow_pistols 1', 'mp_weapons_allow_smgs 0', 'mp_weapons_allow_rifles 0',
    'mp_weapons_allow_heavy 0', 'mp_weapons_allow_zeus 0',
    'mp_t_default_primary 0', 'mp_ct_default_primary 0',
    'mp_t_default_secondary weapon_deagle', 'mp_ct_default_secondary weapon_deagle',
    'mp_t_default_melee 0', 'mp_ct_default_melee 0', 'mp_t_default_grenades 0', 'mp_ct_default_grenades 0',
    'mp_death_drop_gun 0', 'mp_death_drop_grenade 0', ''
  ].join('\n'));
  writeFileSync(join(cfgDir, 'duelplay_knife.cfg'), [
    '// DuelPlay KNIFE ONLY rules', 'mp_freezetime 5', 'mp_roundtime 5', 'mp_roundtime_defuse 5', 'mp_roundtime_hostage 5', 'mp_warmup_end', 'mp_buytime 0', 'mp_buy_anywhere 0',
    'mp_buy_allow_guns 0', 'mp_buy_allow_grenades 0', 'mp_weapons_allow_map_placed 0',
    'mp_weapons_allow_pistols 0', 'mp_weapons_allow_smgs 0', 'mp_weapons_allow_rifles 0',
    'mp_weapons_allow_heavy 0', 'mp_weapons_allow_zeus 0',
    'mp_t_default_primary 0', 'mp_ct_default_primary 0', 'mp_t_default_secondary 0', 'mp_ct_default_secondary 0',
    'mp_t_default_melee weapon_knife', 'mp_ct_default_melee weapon_knife',
    'mp_t_default_grenades 0', 'mp_ct_default_grenades 0', 'mp_death_drop_gun 0', 'mp_death_drop_grenade 0', ''
  ].join('\n'));
  writeFileSync(join(cfgDir, 'duelplay_headshot.cfg'), [
    '// DuelPlay HEADSHOT ONLY rules', 'mp_freezetime 5', 'mp_roundtime 5', 'mp_roundtime_defuse 5', 'mp_roundtime_hostage 5', 'mp_warmup_end', 'mp_buytime 0', 'mp_buy_during_immunity 1', 'mp_respawn_immunitytime 5', 'mp_buy_anywhere 1',
    'mp_buy_allow_guns 255', 'mp_buy_allow_grenades 1', 'mp_weapons_allow_pistols -1', 'mp_weapons_allow_smgs -1', 'mp_weapons_allow_rifles -1', 'mp_weapons_allow_heavy -1', 'mp_weapons_allow_map_placed 1',
    'mp_damage_headshot_only 1', 'mp_death_drop_gun 0', 'mp_death_drop_grenade 0', 'mp_t_default_melee weapon_knife', 'mp_ct_default_melee weapon_knife', ''
  ].join('\n'));
  writeFileSync(join(cfgDir, 'duelplay_first_to_10.cfg'), [
    '// DuelPlay FIRST TO 10 rules', 'mp_freezetime 5', 'mp_roundtime 5', 'mp_roundtime_defuse 5', 'mp_roundtime_hostage 5', 'mp_warmup_end', 'mp_maxrounds 19', 'mp_match_can_clinch 1',
    'mp_halftime 0', 'mp_buytime 0', 'mp_buy_during_immunity 1', 'mp_respawn_immunitytime 5', 'mp_buy_anywhere 1', 'mp_buy_allow_guns 255', 'mp_buy_allow_grenades 1', 'mp_weapons_allow_pistols -1', 'mp_weapons_allow_smgs -1', 'mp_weapons_allow_rifles -1', 'mp_weapons_allow_heavy -1', 'mp_weapons_allow_map_placed 1', 'mp_t_default_melee weapon_knife', 'mp_ct_default_melee weapon_knife', ''
  ].join('\n'));
  const gsi = `"DuelPlay"\n{\n  "uri" "http://127.0.0.1:${MANAGER_PORT}/gsi"\n  "timeout" "1.0"\n  "buffer" "0.0"\n  "throttle" "0.0"\n  "heartbeat" "1.0"\n  "auth"\n  {\n    "token" "${GSI_TOKEN}"\n  }\n  "output"\n  {\n    "precision_time" "3"\n    "precision_position" "1"\n    "precision_vector" "3"\n  }\n  "data"\n  {\n    "provider" "1"\n    "map" "1"\n    "map_round_wins" "1"\n    "round" "1"\n    "player_id" "1"\n    "player_state" "1"\n    "player_match_stats" "1"\n    "player_weapons" "1"\n    "allplayers" "1"\n    "allplayers_id" "1"\n    "allplayers_state" "1"\n    "allplayers_match_stats" "1"\n    "allplayers_weapons" "1"\n    "allplayers_position" "1"\n    "allgrenades" "1"\n    "phase_countdowns" "1"\n  }\n}\n`;
  writeFileSync(join(cfgDir, 'gamestate_integration_duelplay.cfg'), gsi);
}

function command(text) {
  const child = current?.process;
  if (!child || child.killed || child.exitCode !== null || child.stdin.destroyed) return false;
  try { child.stdin.write(`${text}\n`); return true; } catch { return false; }
}

function clearCurrentTimers() {
  if (readyTimer) clearTimeout(readyTimer);
  if (startupDeadlineTimer) clearTimeout(startupDeadlineTimer);
  if (warmupGuardTimer) clearInterval(warmupGuardTimer);
  if (grenadeLoadoutPulseTimer) clearTimeout(grenadeLoadoutPulseTimer);
  readyTimer = null;
  startupDeadlineTimer = null;
  warmupGuardTimer = null;
  grenadeLoadoutPulseTimer = null;
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

function mapCode(name) {
  const raw = String(name || 'Dust2').trim();
  const normalized = raw.replace(/^de_/, '').toLowerCase();
  const customMapNames = new Set([
    'aim_redline', 'aim_dust2', 'fy_pool_day', '1v1_map', '1v1_remastered',
    '1v1_oasis', '1v1_v3', '1v1_arena', '1v1_de_anubis_aim', 'aim_halloween'
  ]);
  if (customMapNames.has(normalized)) return normalized;
  const aliases = { dust2: 'de_dust2' };
  return aliases[normalized] || `de_${normalized}`;
}

function randomWeaponForDuel() {
  // RANDOM_WEAPON: one random native CS2 weapon is selected once per duel.
  // Both players receive the same weapon; no shop/grenades/extra weapons.
  const pool = [
    { weapon: 'weapon_ak47', slot: 'primary' },
    { weapon: 'weapon_m4a1', slot: 'primary' },
    { weapon: 'weapon_m4a1_silencer', slot: 'primary' },
    { weapon: 'weapon_galilar', slot: 'primary' },
    { weapon: 'weapon_famas', slot: 'primary' },
    { weapon: 'weapon_aug', slot: 'primary' },
    { weapon: 'weapon_sg556', slot: 'primary' },
    { weapon: 'weapon_awp', slot: 'primary' },
    { weapon: 'weapon_ssg08', slot: 'primary' },
    { weapon: 'weapon_g3sg1', slot: 'primary' },
    { weapon: 'weapon_scar20', slot: 'primary' },
    { weapon: 'weapon_mac10', slot: 'primary' },
    { weapon: 'weapon_mp9', slot: 'primary' },
    { weapon: 'weapon_mp7', slot: 'primary' },
    { weapon: 'weapon_mp5sd', slot: 'primary' },
    { weapon: 'weapon_ump45', slot: 'primary' },
    { weapon: 'weapon_p90', slot: 'primary' },
    { weapon: 'weapon_bizon', slot: 'primary' },
    { weapon: 'weapon_nova', slot: 'primary' },
    { weapon: 'weapon_xm1014', slot: 'primary' },
    { weapon: 'weapon_mag7', slot: 'primary' },
    { weapon: 'weapon_sawedoff', slot: 'primary' },
    { weapon: 'weapon_m249', slot: 'primary' },
    { weapon: 'weapon_negev', slot: 'primary' },
    { weapon: 'weapon_glock', slot: 'secondary' },
    { weapon: 'weapon_hkp2000', slot: 'secondary' },
    { weapon: 'weapon_usp_silencer', slot: 'secondary' },
    { weapon: 'weapon_p250', slot: 'secondary' },
    { weapon: 'weapon_tec9', slot: 'secondary' },
    { weapon: 'weapon_fiveseven', slot: 'secondary' },
    { weapon: 'weapon_cz75a', slot: 'secondary' },
    { weapon: 'weapon_deagle', slot: 'secondary' },
    { weapon: 'weapon_revolver', slot: 'secondary' },
  ];
  return pool[Math.floor(Math.random() * pool.length)];
}

function pulseGrenadeLoadout() {
  if (!current || resultSent) return;
  const grenadeOnly = current.weaponModifier === 'GRENADE_ONLY' || current.mode === 'GRENADE_ONLY';
  if (!grenadeOnly) return;

  // The plugin should only be enabled long enough to seed the initial 12 grenades.
  // Leaving enforcement enabled causes repeated GiveNamedItem calls and effectively
  // creates an infinite grenade supply. A short pulse is enough for the plugin to
  // configure the round loadout; server-side pickup/shop restrictions stay active.
  const now = Date.now();
  if (now - lastGrenadeLoadoutPulseAt < 3000) return;
  lastGrenadeLoadoutPulseAt = now;

  command('duelplay_grenade_only 1');
  if (grenadeLoadoutPulseTimer) clearTimeout(grenadeLoadoutPulseTimer);
  grenadeLoadoutPulseTimer = setTimeout(() => {
    if (current && !resultSent) command('duelplay_grenade_only 0');
    grenadeLoadoutPulseTimer = null;
  }, 500);
}

function applyDuelRules(mode, weaponModifier) {
  const grenadeOnly = weaponModifier === 'GRENADE_ONLY' || mode === 'GRENADE_ONLY';
  const awpOnly = weaponModifier === 'AWP_ONLY' || mode === 'AWP_ONLY';
  const deagleOnly = weaponModifier === 'DEAGLE_ONLY' || mode === 'DEAGLE_ONLY';
  const knifeOnly = weaponModifier === 'KNIFE_ONLY' || mode === 'KNIFE_ONLY';
  const headshotOnly = weaponModifier === 'HEADSHOT_ONLY' || mode === 'HEADSHOT_ONLY';
  const randomOnly = weaponModifier === 'RANDOM_WEAPON' || mode === 'RANDOM_WEAPON';
  const firstTo10 = mode === 'FIRST_TO_10' || weaponModifier === 'FIRST_TO_10';
  const classicMode = mode === 'SOLO_1V1' && !weaponModifier;
  const buyEnabled = !grenadeOnly && !awpOnly && !deagleOnly && !knifeOnly && !randomOnly;

  command('mp_warmup_online_enabled 0');
  command('mp_warmuptime 0');
  command('mp_warmup_pausetimer 0');
  command('mp_warmup_end');
  command('mp_autoteambalance 0');
  command('mp_limitteams 0');
  command('mp_freezetime 5');
  command('mp_roundtime 2');
  command('mp_roundtime_defuse 2');
  command('mp_roundtime_hostage 2');
  command('mp_buy_during_immunity 0');
  command('duelplay_grenade_only 0');

  if (buyEnabled) {
    // Classic 1v1 / Headshot Only / FIRST_TO_10:
    // 5 seconds of buy time from round start.
    command('mp_buytime 5');
    command('mp_startmoney 16000');
    command('mp_maxmoney 16000');
    command('mp_afterroundmoney 16000');
    command('mp_buy_during_immunity 1');
    command('mp_respawn_immunitytime 5');
    command('mp_buy_anywhere 1');
    command('mp_buy_allow_guns 255');
    command('mp_buy_allow_grenades 1');
    command('mp_weapons_allow_pistols -1');
    command('mp_weapons_allow_smgs -1');
    command('mp_weapons_allow_rifles -1');
    command('mp_weapons_allow_heavy -1');
    command('mp_weapons_allow_zeus 1');
    command('mp_weapons_allow_map_placed 1');
    command('mp_respawn_immunitytime 5');
    command('mp_require_gun_use_to_acquire 0');
    command('sv_allow_ground_weapon_pickup 1');
    command('mp_death_drop_gun 1');
    command('mp_t_default_melee weapon_knife');
    command('mp_ct_default_melee weapon_knife');
    command('mp_match_can_clinch 1');
    command('mp_match_end_restart 0');
    if (firstTo10) {
      command('mp_maxrounds 19');
      command('mp_match_can_clinch 1');
      command('mp_halftime 0');
      command('mp_match_end_restart 0');
    }
  } else {
    // AWP / Deagle / Knife / Grenade / Random: strict loadout, no pickup or purchase.
    command('mp_buytime 0');
    command('mp_buy_anywhere 0');
    command('mp_buy_allow_guns 0');
    command('mp_buy_allow_grenades 0');
    command('mp_weapons_allow_pistols 0');
    command('mp_weapons_allow_smgs 0');
    command('mp_weapons_allow_rifles 0');
    command('mp_weapons_allow_heavy 0');
    command('mp_weapons_allow_zeus 0');
    command('mp_weapons_allow_map_placed 0');
    command('sv_allow_ground_weapon_pickup 0');
    command('mp_death_drop_gun 0');
    command('mp_death_drop_grenade 0');
  }

  if (grenadeOnly) {
    command('exec duelplay_grenade');
    pulseGrenadeLoadout();
  } else if (awpOnly) {
    command('exec duelplay_awp');
    // AWP ONLY: explicitly re-apply the loadout after cfg execution so no pistol,
    // grenade, knife or map-placed weapon can become available.
    command('mp_buytime 0');
    command('mp_buy_anywhere 0');
    command('mp_buy_allow_guns 0');
    command('mp_buy_allow_grenades 0');
    command('mp_weapons_allow_pistols 0');
    command('mp_weapons_allow_smgs 0');
    command('mp_weapons_allow_rifles 0');
    command('mp_weapons_allow_heavy 0');
    command('mp_weapons_allow_zeus 0');
    command('mp_weapons_allow_map_placed 0');
    command('sv_allow_ground_weapon_pickup 0');
    command('mp_death_drop_gun 0');
    command('mp_death_drop_grenade 0');
    command('mp_t_default_primary weapon_awp');
    command('mp_ct_default_primary weapon_awp');
    command('mp_t_default_secondary 0');
    command('mp_ct_default_secondary 0');
    command('mp_t_default_melee weapon_knife');
    command('mp_ct_default_melee weapon_knife');
    command('mp_t_default_grenades 0');
    command('mp_ct_default_grenades 0');
    command('mp_free_armor 2');
  } else if (deagleOnly) {
    command('exec duelplay_deagle');
    // DEAGLE ONLY: explicitly re-apply the loadout after cfg execution.
    // No primary, no grenades, no knife, no shop and no map-placed pickup.
    command('mp_buytime 0');
    command('mp_buy_anywhere 0');
    command('mp_buy_allow_guns 0');
    command('mp_buy_allow_grenades 0');
    command('mp_weapons_allow_pistols 0');
    command('mp_weapons_allow_smgs 0');
    command('mp_weapons_allow_rifles 0');
    command('mp_weapons_allow_heavy 0');
    command('mp_weapons_allow_zeus 0');
    command('mp_weapons_allow_map_placed 0');
    command('sv_allow_ground_weapon_pickup 0');
    command('mp_death_drop_gun 0');
    command('mp_death_drop_grenade 0');
    command('mp_t_default_primary 0');
    command('mp_ct_default_primary 0');
    command('mp_t_default_secondary weapon_deagle');
    command('mp_ct_default_secondary weapon_deagle');
    command('mp_t_default_melee weapon_knife');
    command('mp_ct_default_melee weapon_knife');
    command('mp_t_default_grenades 0');
    command('mp_ct_default_grenades 0');
    command('mp_free_armor 2');
  } else if (knifeOnly) {
    command('exec duelplay_knife');
    // KNIFE ONLY: explicitly re-apply the loadout after cfg execution.
    // No guns, grenades, shop or map-placed weapon pickup.
    command('mp_buytime 0');
    command('mp_buy_anywhere 0');
    command('mp_buy_allow_guns 0');
    command('mp_buy_allow_grenades 0');
    command('mp_weapons_allow_pistols 0');
    command('mp_weapons_allow_smgs 0');
    command('mp_weapons_allow_rifles 0');
    command('mp_weapons_allow_heavy 0');
    command('mp_weapons_allow_zeus 0');
    command('mp_weapons_allow_map_placed 0');
    command('sv_allow_ground_weapon_pickup 0');
    command('mp_death_drop_gun 0');
    command('mp_death_drop_grenade 0');
    command('mp_t_default_primary 0');
    command('mp_ct_default_primary 0');
    command('mp_t_default_secondary 0');
    command('mp_ct_default_secondary 0');
    command('mp_t_default_melee weapon_knife');
    command('mp_ct_default_melee weapon_knife');
    command('mp_t_default_grenades 0');
    command('mp_ct_default_grenades 0');
    command('mp_free_armor 2');
  } else if (headshotOnly) {
    command('exec duelplay_headshot');
    // Restore Classic pickup/buy behavior after headshot cfg is loaded.
    command('mp_freezetime 5');
    command('mp_buytime 0');
    command('mp_buy_during_immunity 1');
    command('mp_respawn_immunitytime 5');
    command('mp_buy_anywhere 1');
    command('mp_buy_allow_guns 255');
    command('mp_buy_allow_grenades 1');
    command('mp_weapons_allow_pistols -1');
    command('mp_weapons_allow_smgs -1');
    command('mp_weapons_allow_rifles -1');
    command('mp_weapons_allow_heavy -1');
    command('mp_weapons_allow_zeus 1');
    command('mp_weapons_allow_map_placed 1');
    command('mp_require_gun_use_to_acquire 0');
    command('sv_allow_ground_weapon_pickup 1');
    command('mp_death_drop_gun 1');
    command('mp_death_drop_grenade 1');
    command('mp_t_default_melee weapon_knife');
    command('mp_ct_default_melee weapon_knife');
    // HEADSHOT ONLY: every normal weapon/grenade remains available, but
    // damage is restricted to headshots. Re-apply after cfg so nothing
    // from duelplay_headshot.cfg can disable the full shop.
    command('mp_damage_headshot_only 1');
  } else if (randomOnly) {
    const random = current?.randomWeapon || randomWeaponForDuel();
    if (current) current.randomWeapon = random;

    // RANDOM_WEAPON is a closed loadout: exactly one randomly selected weapon
    // for both players, with no shop, grenades, knife or map-placed pickups.
    command('mp_buytime 0');
    command('mp_buy_anywhere 0');
    command('mp_buy_allow_guns 0');
    command('mp_buy_allow_grenades 0');
    command('mp_weapons_allow_pistols 0');
    command('mp_weapons_allow_smgs 0');
    command('mp_weapons_allow_rifles 0');
    command('mp_weapons_allow_heavy 0');
    command('mp_weapons_allow_zeus 0');
    command('mp_weapons_allow_map_placed 0');
    command('sv_allow_ground_weapon_pickup 0');
    command('mp_require_gun_use_to_acquire 0');
    command('mp_death_drop_gun 0');
    command('mp_death_drop_grenade 0');
    command('mp_t_default_melee weapon_knife');
    command('mp_ct_default_melee weapon_knife');
    command('mp_t_default_grenades 0');
    command('mp_ct_default_grenades 0');
    command('mp_free_armor 2');

    if (random.slot === 'primary') {
      command('mp_t_default_primary ' + random.weapon);
      command('mp_ct_default_primary ' + random.weapon);
      command('mp_t_default_secondary 0');
      command('mp_ct_default_secondary 0');
    } else {
      command('mp_t_default_primary 0');
      command('mp_ct_default_primary 0');
      command('mp_t_default_secondary ' + random.weapon);
      command('mp_ct_default_secondary ' + random.weapon);
    }
  } else {
    // Classic 1v1: fully open native CS2 shop. Knife is carried by default; CS2 does not sell knives in the native buy menu.
    command('mp_weapons_allow_pistols -1');
    command('mp_weapons_allow_smgs -1');
    command('mp_weapons_allow_rifles -1');
    command('mp_weapons_allow_heavy -1');
    command('mp_weapons_allow_zeus 1');
    command('mp_weapons_allow_map_placed 1');
    command('mp_require_gun_use_to_acquire 0');
    command('sv_allow_ground_weapon_pickup 1');
    command('mp_death_drop_gun 1');
    command('mp_match_can_clinch 1');
    command('mp_match_end_restart 0');
  }
}

const WORKSHOP_MAP_SOURCE_FOLDERS = Object.freeze({
  '3754320383': 'aim_cache',
  '3592238209': 'fy_snow_legacy',
  '3383710636': 'testmap',
  '3596198331': 'halloween_map',
});

function safeMapConfigName(name) {
  const value = String(name || '').trim().toLowerCase();
  return /^[a-z0-9_]+$/.test(value) ? value : null;
}

function buildMatchMapConfig(mode, weaponModifier) {
  const classicMode = mode === 'SOLO_1V1' && !weaponModifier;
  const grenadeOnly = weaponModifier === 'GRENADE_ONLY' || mode === 'GRENADE_ONLY';
  const awpOnly = weaponModifier === 'AWP_ONLY' || mode === 'AWP_ONLY';
  const deagleOnly = weaponModifier === 'DEAGLE_ONLY' || mode === 'DEAGLE_ONLY';
  const knifeOnly = weaponModifier === 'KNIFE_ONLY' || mode === 'KNIFE_ONLY';
  const headshotOnly = weaponModifier === 'HEADSHOT_ONLY' || mode === 'HEADSHOT_ONLY';
  const randomOnly = weaponModifier === 'RANDOM_WEAPON' || mode === 'RANDOM_WEAPON';
  const firstTo10 = mode === 'FIRST_TO_10' || weaponModifier === 'FIRST_TO_10';
  const buyEnabled = !grenadeOnly && !awpOnly && !deagleOnly && !knifeOnly && !randomOnly;

  const lines = [
    '// DuelPlay per-match map rules. Generated before Workshop map load.',
    'mp_freezetime 5',
    'mp_roundtime 2',
    'mp_roundtime_defuse 2',
    'mp_roundtime_hostage 2',
    'mp_buy_during_immunity 1',
    'mp_respawn_immunitytime 5',
  ];

  if (buyEnabled) {
    lines.push(
      'mp_buytime 5',
      'mp_startmoney 16000',
      'mp_maxmoney 16000',
      'mp_afterroundmoney 16000',
      'mp_buy_anywhere 1',
      'mp_buy_allow_guns 255',
      'mp_buy_allow_grenades 1',
      'mp_weapons_allow_pistols -1',
      'mp_weapons_allow_smgs -1',
      'mp_weapons_allow_rifles -1',
      'mp_weapons_allow_heavy -1',
      'mp_weapons_allow_zeus 1',
      'mp_weapons_allow_map_placed 1',
      'mp_require_gun_use_to_acquire 0',
      'sv_allow_ground_weapon_pickup 1',
      'mp_death_drop_gun 1',
      'mp_death_drop_grenade 1',
      'mp_t_default_melee weapon_knife',
      'mp_ct_default_melee weapon_knife',
    );
  } else {
    lines.push(
      'mp_buytime 0',
      'mp_buy_anywhere 0',
      'mp_buy_allow_guns 0',
      'mp_buy_allow_grenades 0',
      'mp_weapons_allow_pistols 0',
      'mp_weapons_allow_smgs 0',
      'mp_weapons_allow_rifles 0',
      'mp_weapons_allow_heavy 0',
      'mp_weapons_allow_zeus 0',
      'mp_weapons_allow_map_placed 0',
      'sv_allow_ground_weapon_pickup 0',
      'mp_death_drop_gun 0',
      'mp_t_default_melee weapon_knife',
      'mp_ct_default_melee weapon_knife',
      'mp_death_drop_grenade 0',
    );
  }

  lines.push('mp_damage_headshot_only ' + (headshotOnly ? '1' : '0'));

  if (firstTo10) {
    lines.push('mp_maxrounds 19', 'mp_match_can_clinch 1', 'mp_halftime 0', 'mp_match_end_restart 0');
  }

  if (awpOnly) {
    lines.push('mp_t_default_primary weapon_awp', 'mp_ct_default_primary weapon_awp', 'mp_t_default_secondary 0', 'mp_ct_default_secondary 0', 'mp_t_default_melee weapon_knife', 'mp_ct_default_melee weapon_knife', 'mp_t_default_grenades 0', 'mp_ct_default_grenades 0', 'mp_free_armor 2');
  } else if (deagleOnly) {
    lines.push(
      'mp_t_default_primary 0',
      'mp_ct_default_primary 0',
      'mp_t_default_secondary weapon_deagle',
      'mp_ct_default_secondary weapon_deagle',
      'mp_t_default_melee weapon_knife',
      'mp_ct_default_melee weapon_knife',
      'mp_t_default_grenades 0',
      'mp_ct_default_grenades 0',
      'mp_free_armor 2'
    );
  } else if (knifeOnly) {
    lines.push('mp_t_default_primary 0', 'mp_ct_default_primary 0', 'mp_t_default_secondary 0', 'mp_ct_default_secondary 0', 'mp_t_default_melee weapon_knife', 'mp_ct_default_melee weapon_knife', 'mp_t_default_grenades 0', 'mp_ct_default_grenades 0');
  } else if (randomOnly) {
    // The exact random weapon is applied by applyDuelRules after the match is claimed.
    // Keep the per-map config closed so the map cannot re-enable shop/pickups.
    lines.push(
      'mp_t_default_primary 0',
      'mp_ct_default_primary 0',
      'mp_t_default_secondary 0',
      'mp_ct_default_secondary 0',
      'mp_t_default_melee weapon_knife',
      'mp_ct_default_melee weapon_knife',
      'mp_t_default_grenades 0',
      'mp_ct_default_grenades 0',
      'mp_free_armor 2'
    );
  } else if (grenadeOnly) {
    // Enable only through the short per-round pulse; never leave enforcement on in the map cfg.
    lines.push('duelplay_grenade_only 0');
  } else {
    lines.push('duelplay_grenade_only 0');
  }

  return lines.join('\n') + '\n';
}

function writeMatchMapConfig(mapNames, mode, weaponModifier) {
  const mapCfgDir = join(CS2_DIR, 'csgo', 'cfg', 'maps');
  mkdirSync(mapCfgDir, { recursive: true });
  const content = buildMatchMapConfig(mode, weaponModifier);
  for (const name of mapNames) {
    const safe = safeMapConfigName(name);
    if (!safe) continue;
    writeFileSync(join(mapCfgDir, `${safe}.cfg`), content);
  }
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
  applyDuelRules(current.mode, current.weaponModifier);
  command('mp_warmup_end'); command('mp_restartgame 1');
  setTimeout(() => {
    if (!current) return;
    applyDuelRules(current.mode, current.weaponModifier);
      command('mp_warmup_end');
  }, 2500);
}

function observeServerLine(text) {
  if (!current || resultSent) return;

  // CS2 logs an authenticated Steam Net connection before warmup ends.
  // Use this for immediate 1/2 detection instead of waiting for a team line.
  if (/World triggered \"Round_Start\"/i.test(text)) {
    const now = Date.now();
    if (now - lastRoundRuleApplyAt > 1500) {
      lastRoundRuleApplyAt = now;
      const reapplyRoundRules = (delay) => {
        setTimeout(() => {
          if (!current || resultSent) return;
          applyDuelRules(current.mode, current.weaponModifier);
          if (delay >= 1000) pulseGrenadeLoadout();
        }, delay);
      };
      // Workshop maps can re-apply their own cvars after Round_Start.
      // Re-assert DuelPlay rules after the map has finished doing so.
      reapplyRoundRules(150);
      reapplyRoundRules(1000);
      reapplyRoundRules(2500);
      reapplyRoundRules(5000);
    }
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

      // Force the next manager tick to send the new count immediately.
      lastHeartbeatSentAt = 0;
      if (connectedSteamIds.length >= 2) {
        connectionPhaseCompleted = true;
      }
      if (current) {
        finalizePlayerLoadoutAfterConnect();
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
      }

      console.log(
        `[DuelPlay] server log player ${playerSteamId} connected (${connectedSteamIds.length}/2)`
      );
      if (current) finalizePlayerLoadoutAfterConnect();
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
  const workshopId = claimed.workshopId ? String(claimed.workshopId).trim() : '';
  const mapConfigNames = new Set();
  if (match.mapName) mapConfigNames.add(String(match.mapName));
  const fallbackMapName = mapCode(match.mapName);
  if (fallbackMapName) mapConfigNames.add(String(fallbackMapName));
  const workshopSourceFolder = WORKSHOP_MAP_SOURCE_FOLDERS[workshopId];
  if (workshopSourceFolder) mapConfigNames.add(workshopSourceFolder);
  writeMatchMapConfig([...mapConfigNames], mode, weaponModifier);
  const mapLaunchArgs = workshopId
    ? ['+map', 'de_dust2', '+host_workshop_map', workshopId]
    : (() => {
        const fallback = mapCode(match.mapName);
        if (/^(aim_|fy_|1v1_)/i.test(fallback)) {
          throw new Error(`Workshop ID is required for custom duel map: ${fallback}`);
        }
        return ['+map', fallback];
      })();
  const args = [
    '-dedicated', '-console', '-usercon', '-port', String(runtimePort), '-maxplayers', '2',
    '+game_type', '0', '+game_mode', '1', ...mapLaunchArgs,
    '+sv_lan', '0', '+sv_visiblemaxplayers', '2', '+bot_quota', '0', '+bot_quota_mode', 'normal',
    '+mp_autoteambalance', '0', '+mp_limitteams', '0', '+mp_freezetime', '5', '+mp_roundtime', '2', '+mp_roundtime_defuse', '2', '+mp_roundtime_hostage', '2', '+mp_buytime', '5', '+mp_buy_during_immunity', '1', '+mp_respawn_immunitytime', '5', '+mp_buy_anywhere', '1', '+mp_buy_allow_guns', '255', '+mp_buy_allow_grenades', '1', '+mp_weapons_allow_pistols', '-1', '+mp_weapons_allow_smgs', '-1', '+mp_weapons_allow_rifles', '-1', '+mp_weapons_allow_heavy', '-1', '+mp_weapons_allow_zeus', '1', '+mp_weapons_allow_map_placed', '1', '+mp_require_gun_use_to_acquire', '0', '+sv_allow_ground_weapon_pickup', '1', '+mp_death_drop_gun', '1', '+mp_warmup_online_enabled', '0', '+mp_warmuptime', '0', '+mp_warmup_pausetimer', '0', '+mp_warmup_end', '+mp_maxrounds', '19', '+mp_match_can_clinch', '1', '+mp_halftime', '0', '+mp_match_end_restart', '0',
    ...(weaponModifier === 'GRENADE_ONLY' || mode === 'GRENADE_ONLY' ? ['+exec', 'duelplay_grenade'] : []),
    ...(weaponModifier === 'AWP_ONLY' || mode === 'AWP_ONLY' ? ['+exec', 'duelplay_awp'] : []),
    ...(weaponModifier === 'DEAGLE_ONLY' || mode === 'DEAGLE_ONLY' ? ['+exec', 'duelplay_deagle'] : []),
    ...(weaponModifier === 'KNIFE_ONLY' || mode === 'KNIFE_ONLY' ? ['+exec', 'duelplay_knife'] : []),
    ...(weaponModifier === 'HEADSHOT_ONLY' || mode === 'HEADSHOT_ONLY' ? ['+exec', 'duelplay_headshot'] : []),
    ...(mode === 'FIRST_TO_10' ? ['+exec', 'duelplay_first_to_10'] : [])
  ];
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
  current = {
    id: match.id,
    serverId: claimed.serverId,
    playerOneSteamId: match.playerOne.steamId,
    playerTwoSteamId: match.playerTwo.steamId,
    mapName: match.mapName || 'Dust2',
    mode,
    weaponModifier,
    randomWeapon: null,
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
  lastGrenadeLoadoutPulseAt = 0;
  lastRoundRuleApplyAt = 0;
  resetRefereeState();

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    process.stdout.write(`[CS2] ${text}`);
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
          command('mp_warmup_online_enabled 0');
      command('mp_warmuptime 0');
      command('mp_warmup_end');
      command('mp_restartgame 1');
      [1500, 3000, 5000].forEach((delay) => {
        setTimeout(() => {
          if (!current || current.id !== match.id) return;
          applyDuelRules(current.mode, current.weaponModifier);
        }, delay);
      });
      command('mp_match_can_clinch 1');
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
      connectedSteamIds = [];
      connectionPhaseCompleted = false;
      lastHeartbeatSentAt = 0;
      if (warmupGuardTimer) clearInterval(warmupGuardTimer);
  if (grenadeLoadoutPulseTimer) clearTimeout(grenadeLoadoutPulseTimer);
      let warmupGuardTicks = 0;
      warmupGuardTimer = setInterval(() => {
        if (!current || current.id !== match.id || warmupGuardTicks++ >= 12) {
          if (warmupGuardTimer) clearInterval(warmupGuardTimer);
  if (grenadeLoadoutPulseTimer) clearTimeout(grenadeLoadoutPulseTimer);
          warmupGuardTimer = null;
          return;
        }
        command('mp_warmup_online_enabled 0');
        command('mp_warmuptime 0');
        command('mp_warmup_pausetimer 0');
        command('mp_warmup_end');
      }, 500);
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
  if (current.mode === 'FIRST_TO_10') {
    const ctScore = Number(map?.team_ct?.score ?? -1);
    const tScore = Number(map?.team_t?.score ?? -1);
    if (ctScore >= 10 || tScore >= 10) {
      const winnerTeam = ctScore >= 10 && tScore >= 10
        ? (ctScore > tScore ? 'CT' : 'T')
        : (ctScore >= 10 ? 'CT' : 'T');
      const winner = [...observedTeams.entries()].find(([, team]) => team === winnerTeam)?.[0] || null;
      if (winner) {
        void reportWinner(winner, `FIRST_TO_10 reached ${winnerTeam} score=${Math.max(ctScore, tScore)}`);
        return;
      }
    }
  }
  const phase = String(map?.phase || '').toLowerCase();

  if (!['gameover', 'over'].includes(phase)) return;

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
    res.end(JSON.stringify({ ok: true, matchId: current?.id || null, gsiAgeMs: lastGsiAt ? Date.now() - lastGsiAt : null }));
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
}).listen(MANAGER_PORT, '127.0.0.1', () => console.log(`[DuelPlay] manager listening on 127.0.0.1:${MANAGER_PORT}`));

async function loop() {
  try {
    if (!current) {
      const queue = await api('/api/server-manager/queue');
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

