import assert from 'node:assert/strict';
import fs from 'node:fs';

const modeSource = fs.readFileSync('lib/duel-modes.ts', 'utf8');
const mapSource = fs.readFileSync('lib/duel-maps.ts', 'utf8');
const createSource = fs.readFileSync('components/CreateMatch/CreateMatch.tsx', 'utf8');
const matchmakingSource = fs.readFileSync('components/Matchmaking/MatchmakingPanel.tsx', 'utf8');
const matchSource = fs.readFileSync('app/matches/[id]/page.tsx', 'utf8');
const liveSource = fs.readFileSync('components/Live/Live.tsx', 'utf8');
const schemaSource = fs.readFileSync('prisma/schema.prisma', 'utf8');

assert.ok(!/id:\s*"HIGH_STAKES"/.test(modeSource), 'High Stakes must not be a selectable duel mode');
assert.ok(!/HIGH_STAKES:\s*boolean/.test(mapSource), 'Map compatibility must not expose High Stakes');
assert.ok(!/HIGH_STAKES:\s*true/.test(mapSource), 'Maps must not advertise High Stakes support');
assert.ok(!/HIGH_STAKES/.test(createSource), 'Create Match must not expose High Stakes');
assert.ok(!/HIGH_STAKES/.test(matchmakingSource), 'Matchmaking must not expose High Stakes');
assert.ok(!/HIGH_STAKES/.test(matchSource), 'Match page must not render High Stakes');
assert.ok(!/HIGH_STAKES/.test(liveSource), 'Live cards must not render High Stakes');
assert.ok(!/HIGH_STAKES/.test(schemaSource), 'Prisma schema must not contain High Stakes');
assert.match(modeSource, /GRENADE_ONLY/);
assert.match(mapSource, /GRENADE_ONLY/);
console.log('High Stakes removed from runtime/schema + Grenade Only present: PASS');
