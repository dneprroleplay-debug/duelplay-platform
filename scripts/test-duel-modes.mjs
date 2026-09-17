import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../lib/duel-modes.ts', import.meta.url), 'utf8');
assert.match(source, /SOLO_1V1/);
for (const mode of ['AWP_ONLY','DEAGLE_ONLY','KNIFE_ONLY','HEADSHOT_ONLY','RANDOM_WEAPON','FIRST_TO_10','GRENADE_ONLY']) assert.match(source, new RegExp(mode));
assert.match(source, /MODE_MODIFIER_CONFLICT/);
assert.match(source, /DUEL_FORMATS/);
console.log('duel modes policy: PASS');

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
assert.ok(!schema.includes('HIGH_STAKES'), 'High Stakes must be absent from Prisma schema');
assert.match(schema, /GRENADE_ONLY/);
