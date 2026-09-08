import fs from 'node:fs';
import assert from 'node:assert/strict';

const lifecycle = fs.readFileSync('lib/match-lifecycle.ts', 'utf8');
const serverRoute = fs.readFileSync('app/api/matches/[id]/server/route.ts', 'utf8');
const manager = fs.readFileSync('scripts/server-manager/server-manager.mjs', 'utf8');

assert.match(lifecycle, /export async function resolveConnectionTimeout/);
assert.match(lifecycle, /const pot = Number\(full\.betAmount\) \* 2/);
assert.match(lifecycle, /const payout = Number\(\(pot - fee\)\.toFixed\(4\)\)/);
assert.match(lifecycle, /creditWallet\(tx, winnerId, payout, idem, "MATCH_WIN"/);
assert.match(lifecycle, /status: "FINISHED"/);
assert.match(serverRoute, /action === "connection-timeout"/);
assert.match(serverRoute, /resolveConnectionTimeout\(id, winnerSteamId\)/);
assert.match(serverRoute, /technicalWin: true/);
assert.match(manager, /action: 'connection-timeout'/);
assert.match(manager, /connectedSteamId: connected\[0\]/);
console.log('Technical timeout payout checks passed.');
