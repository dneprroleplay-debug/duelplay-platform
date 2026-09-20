import fs from 'node:fs';
import assert from 'node:assert/strict';
const page = fs.readFileSync('app/matches/[id]/page.tsx', 'utf8');
const timers = fs.readFileSync('lib/match-timers.ts', 'utf8');
const lifecycle = fs.readFileSync('lib/match-lifecycle.ts', 'utf8');
const serverRoute = fs.readFileSync('app/api/matches/[id]/server/route.ts', 'utf8');
const presenceRoute = fs.readFileSync('app/api/matches/[id]/presence/route.ts', 'utf8');

assert.ok(timers.includes('MATCH_START_TIMEOUT_MS = positiveMs("DUELPLAY_START_TIMEOUT_MS", 2 * 60 * 1000)'), 'FAIL: START timeout must default to 2 minutes');
assert.ok(timers.includes('MATCH_LIVE_TIMEOUT_MS = positiveMs("DUELPLAY_LIVE_TIMEOUT_MS", 5 * 60 * 1000)'), 'FAIL: 5-minute connection timeout source missing');
assert.ok(serverRoute.includes('connectionDeadlineAt: null'), 'FAIL: separate connection deadline must not be created');
assert.ok(serverRoute.includes('liveDeadlineAt: deadlineFromNow(MATCH_LIVE_TIMEOUT_MS, startedAt.getTime())'), 'FAIL: LIVE deadline must be the single 5-minute connection deadline');
assert.ok(page.includes('maxSeconds:300'), 'FAIL: connection UI timeout must be 5 minutes');
assert.ok(page.includes('+5*60*1000'), 'FAIL: connection fallback deadline must be 5 minutes');
assert.ok(!page.includes('maxSeconds:600'), 'FAIL: 10-minute UI timer must not exist');
assert.ok(!page.includes('+10*60*1000'), 'FAIL: 10-minute fallback deadline must not exist');
assert.ok(!page.includes('live duel timer is 5 minutes'), 'FAIL: active duel must not display a second 5-minute live timer');
assert.ok(lifecycle.includes('No player connected within 5 minutes'), 'FAIL: lifecycle timeout reason must be 5 minutes');
assert.ok(serverRoute.includes('No player connected within 5 minutes'), 'FAIL: server route timeout reason must be 5 minutes');
assert.ok(presenceRoute.includes('match.liveDeadlineAt'), 'FAIL: presence endpoint must use the authoritative 5-minute deadline');
assert.ok(!presenceRoute.includes('No player connected within 10 minutes'), 'FAIL: stale 10-minute cancellation reason remains');
assert.ok(page.includes('m.liveState?.connectionPhaseCompleted!==true'), 'FAIL: countdown must disappear once both players are connected');

console.log('Final match timer policy 2m START + 5m connection + unlimited active duel: PASS');
