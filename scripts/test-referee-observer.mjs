import { readFileSync } from 'node:fs';

const manager = readFileSync('scripts/server-manager/server-manager.mjs', 'utf8');
const serverRoute = readFileSync('app/api/matches/[id]/server/route.ts', 'utf8');
const schema = readFileSync('prisma/schema.prisma', 'utf8');
const migration = readFileSync('prisma/migrations/20260915180000_match_referee_events/migration.sql', 'utf8');

const requiredGsiKeys = [
  '"map_round_wins" "1"',
  '"player_match_stats" "1"',
  '"player_weapons" "1"',
  '"allplayers_id" "1"',
  '"allplayers_state" "1"',
  '"allplayers_match_stats" "1"',
  '"allplayers_weapons" "1"',
  '"allplayers_position" "1"',
  '"allgrenades" "1"',
  '"phase_countdowns" "1"',
];
for (const key of requiredGsiKeys) if (!manager.includes(key)) throw new Error(`Missing GSI key: ${key}`);
for (const marker of ['resetRefereeState', 'observeRefereeState', 'queueRefereeEvent', 'PLAYER_CONNECTED', 'PLAYER_DISCONNECTED', 'ROUND_STARTED', 'ROUND_ENDED', 'PLAYER_STATS_CHANGED', 'PLAYER_ROUND_STATS_CHANGED', 'PLAYER_WEAPON_CHANGED']) {
  if (!manager.includes(marker)) throw new Error(`Missing referee marker: ${marker}`);
}
if (!serverRoute.includes('action === "referee-event"')) throw new Error('Referee event API action missing');
if (!serverRoute.includes('matchRefereeEvent.create')) throw new Error('Referee event persistence missing');
if (!serverRoute.includes('refereeState')) throw new Error('Referee state heartbeat missing');
if (!schema.includes('model MatchRefereeEvent')) throw new Error('MatchRefereeEvent model missing');
if (!schema.includes('refereeEvents MatchRefereeEvent[]')) throw new Error('Match referee relation missing');
if (!migration.includes('CREATE TABLE "MatchRefereeEvent"')) throw new Error('Referee migration missing');
if (!migration.includes('"matchId", "sequence"')) throw new Error('Referee idempotency index missing');

console.log('Referee observer foundation: PASS');
