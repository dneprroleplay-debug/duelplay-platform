import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const API = required('DUELPLAY_API_URL').replace(/\/$/, '');
const SECRET = required('DUELPLAY_SERVER_MANAGER_SECRET');
const GSI_TOKEN = required('CS2_GSI_TOKEN');
const CS2_DIR = process.env.CS2_DIR || '/home/ubuntu/cs2/game';
const CS2_SCRIPT = join(CS2_DIR, 'cs2.sh');
const HOST = process.env.CS2_PUBLIC_HOST || '127.0.0.1';
const PORT = Number(process.env.CS2_PORT || 27015);
const SERVER_ID = process.env.DUELPLAY_SERVER_ID || 'cs2-1';
const MANAGER_PORT = Number(process.env.DUELPLAY_MANAGER_PORT || 3010);
const READY_DELAY_MS = Number(process.env.CS2_READY_DELAY_MS || 20000);
const POLL_MS = 2000;
const HEARTBEAT_MS = 10000;
const CONNECT_TIMEOUT_MS = Number(process.env.CS2_CONNECT_TIMEOUT_MS || 10 * 60 * 1000);

if (!existsSync(CS2_SCRIPT)) throw new Error(`CS2 script not found: ${CS2_SCRIPT}`);

let current = null;
let lastGsiAt = 0;
let resultSent = false;
let serverReadyAt = 0;
let connectedSteamIds = [];
let connectionPhaseCompleted = false;
let lastHeartbeatSentAt = 0;
let lastRoundWinnerTeam = null;
const observedTeams = new Map();

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
    'mp_warmup_end',
    'mp_match_can_clinch 1',
    'mp_match_end_restart 0',
    'log on',
    'sv_logecho 1',
    'sv_logfile 1',
    'mp_logmessages 1',
    ''
  ].join('\n'));
  const gsi = `"DuelPlay"\n{\n  "uri" "http://127.0.0.1:${MANAGER_PORT}/gsi"\n  "timeout" "1.0"\n  "buffer" "0.0"\n  "throttle" "0.0"\n  "heartbeat" "1.0"\n  "auth"\n  {\n    "token" "${GSI_TOKEN}"\n  }\n  "data"\n  {\n    "provider" "1"\n    "map" "1"\n    "round" "1"\n    "player_id" "1"\n    "player_state" "1"\n    "allplayers" "1"\n    "allplayers_id" "1"\n    "phase_countdowns" "1"\n  }\n}\n`;
  writeFileSync(join(cfgDir, 'gamestate_integration_duelplay.cfg'), gsi);
}

function command(text) {
  if (current?.process && !current.process.killed) current.process.stdin.write(`${text}\n`);
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
  const normalized = String(name || 'Dust2').replace(/^de_/, '').toLowerCase();
  const aliases = { dust2: 'de_dust2' };
  return aliases[normalized] || `de_${normalized}`;
}


function steam64FromSteam3(value) {
  const match = String(value).match(/\[U:1:(\d+)\]/);
  if (!match) return null;
  return String(76561197960265728n + BigInt(match[1]));
}\n\nfunction normalizeSteamId(value) {
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

  if (normalized === p1) return current.playerOneSteamId;
  if (normalized === p2) return current.playerTwoSteamId;

  return null;
}

function observeServerLine(text) {
  if (!current || resultSent) return;
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
  const args = [
    '-dedicated', '-console', '-usercon', '-port', String(PORT), '-maxplayers', '2',
    '+game_type', '0', '+game_mode', '1', '+map', mapCode(match.mapName),
    '+sv_lan', '0', '+sv_visiblemaxplayers', '2', '+bot_quota', '0', '+bot_quota_mode', 'normal',
    '+mp_autoteambalance', '0', '+mp_limitteams', '0'
  ];
  console.log(`[DuelPlay] starting ${match.id} on ${HOST}:${PORT}`);
  const child = spawn(CS2_SCRIPT, args, { cwd: CS2_DIR, stdio: 'pipe', env: process.env });
  current = {
    id: match.id,
    serverId: claimed.serverId,
    playerOneSteamId: match.playerOne.steamId,
    playerTwoSteamId: match.playerTwo.steamId,
    mapName: match.mapName || 'Dust2',
    process: child,
    startedAt: Date.now()
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
  lastHeartbeatSentAt = 0;

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
  child.on('exit', async (code, signal) => {
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

  setTimeout(async () => {
    if (!current || current.id !== match.id) return;
    try {
      command('bot_kick');
      command('bot_quota 0');
      command('bot_quota_mode normal');
      command('mp_autoteambalance 0');
      command('mp_limitteams 0');
      command('mp_match_can_clinch 1');
      command('mp_match_end_restart 0');
      command('sv_visiblemaxplayers 2');
      command('log on');
      command('sv_logecho 1');
      command('sv_logfile 1');
      command('mp_logmessages 1');
      await api(`/api/matches/${match.id}/server`, {
        method: 'POST',
        body: JSON.stringify({ action: 'ready', serverId: current.serverId, host: HOST, port: PORT, processId: current.process.pid })
      });
      serverReadyAt = Date.now();
      connectedSteamIds = [];
      connectionPhaseCompleted = false;
      lastHeartbeatSentAt = 0;
      console.log(`[DuelPlay] server ready: steam://connect/${HOST}:${PORT}`);
    } catch (error) {
      console.error('[DuelPlay] server failed to become ready', error);
      try {
        await api(`/api/matches/${match.id}/server`, { method: 'POST', body: JSON.stringify({ action: 'failed', serverId: current.serverId }) });
      } catch {}
      command('quit');
    }
  }, READY_DELAY_MS);
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
      headers: { 'content-type': 'application/json', 'x-cs2-result-secret': SECRET },
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

function detectWinner(body) {
  if (!current) return;

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
              connectionPhaseCompleted
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
        const participants = [
          current.playerOneSteamId,
          current.playerTwoSteamId
        ].filter(Boolean);

        const connected = connectedSteamIds.filter((steamId) =>
          participants.includes(steamId)
        );

        if (connected.length === 1) {
          console.log(`[DuelPlay] connection timeout: ${connected[0]} connected, awarding technical win`);
          await reportWinner(
            connected[0],
            'connection timeout: opponent did not connect'
          );
        } else {
          console.log('[DuelPlay] connection timeout: nobody connected, refunding stakes');

          try {
            await api(`/api/matches/${current.id}/server`, {
              method: 'POST',
              body: JSON.stringify({
                action: 'failed',
                serverId: current.serverId
              })
            });
          } catch (error) {
            console.error('[DuelPlay] timeout refund failed', error);
          }

          command('quit');
        }
      }

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

writeConfigs();
void loop();

function shutdown() {
  if (current) command('quit');
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

