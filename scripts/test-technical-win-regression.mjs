import fs from 'node:fs';

const result = fs.readFileSync('app/api/matches/[id]/result/route.ts', 'utf8');
const lifecycle = fs.readFileSync('lib/match-lifecycle.ts', 'utf8');
const manager = fs.readFileSync('scripts/server-manager/server-manager.mjs', 'utf8');

const checks = [
  ['result locks the match server-side', result.includes('lockMatchForUpdate(tx, id)')],
  ['watchdog locks the match before settlement', lifecycle.includes('lockMatchForUpdate(tx, matchId)')],
  ['manager null guard after technical result', manager.includes('if (!current || current.id !== timedOutMatchId) return;')],
  ['manager state-poll null guard', manager.includes('if (!current) return;\n      try {\n        const state = await api(`/api/matches/${current.id}`);')],
];

let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failed = true;
}
if (failed) process.exit(1);
console.log('Technical win regression checks passed.');
