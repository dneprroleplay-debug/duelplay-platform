import { readFileSync } from 'node:fs';

const manager = readFileSync('scripts/server-manager/server-manager.mjs', 'utf8');
const serverRoute = readFileSync('app/api/matches/[id]/server/route.ts', 'utf8');
const schema = readFileSync('prisma/schema.prisma', 'utf8');
const baseline = readFileSync('prisma/migrations/00000000000000_duelplay_baseline/migration.sql', 'utf8');

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
if (!/model MatchRefereeEvent\s*\{[\s\S]*?@@unique\(\[matchId, sequence\]\)/.test(schema)) throw new Error('MatchRefereeEvent model/idempotency constraint missing');
if (!schema.includes('refereeEvents MatchRefereeEvent[]')) throw new Error('Match referee relation missing');
if (!/CREATE TABLE "MatchRefereeEvent" \([\s\S]*?"matchId" UUID NOT NULL[\s\S]*?"sequence" INTEGER NOT NULL[\s\S]*?CONSTRAINT "MatchRefereeEvent_pkey" PRIMARY KEY \("id"\)/.test(baseline)) throw new Error('Baseline referee table missing required columns');
if (!baseline.includes('CREATE UNIQUE INDEX "MatchRefereeEvent_matchId_sequence_key" ON "MatchRefereeEvent"("matchId", "sequence")')) throw new Error('Baseline referee idempotency index missing');
if (!baseline.includes('ALTER TABLE "MatchRefereeEvent" ADD CONSTRAINT "MatchRefereeEvent_matchId_fkey"')) throw new Error('Baseline referee match relation missing');

console.log('Referee observer foundation: PASS');
