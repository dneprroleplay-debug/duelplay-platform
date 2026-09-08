import fs from 'node:fs';

const serverRoute = fs.readFileSync('app/api/matches/[id]/server/route.ts', 'utf8');
const manager = fs.readFileSync('scripts/server-manager/server-manager.mjs', 'utf8');
const env = fs.readFileSync('scripts/server-manager/.env.example', 'utf8');

const checks = [
  ['READY uses standard Steam connect URL', serverRoute.includes('connectUrl: `steam://connect/${host}:${port}`')],
  ['CS2 manager updates dedicated server before queue processing', manager.includes('updateCs2Server();') && manager.includes("'+app_update', String(CS2_APP_ID), 'validate', '+quit'")],
  ['CS2 auto-update is enabled by default', manager.includes("process.env.CS2_AUTO_UPDATE ?? 'true'")],
  ['SteamCMD path is configurable', manager.includes("process.env.STEAMCMD_BIN || 'steamcmd'") && env.includes('STEAMCMD_BIN=steamcmd')],
  ['CS2 app id defaults to 730', manager.includes('process.env.CS2_APP_ID || 730') && env.includes('CS2_APP_ID=730')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
if (failed.length) process.exit(1);
console.log(`\nAll ${checks.length} CS2 launch policy checks passed.`);
