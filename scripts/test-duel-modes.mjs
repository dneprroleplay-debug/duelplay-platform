import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../lib/duel-modes.ts', import.meta.url), 'utf8');
assert.match(source, /SOLO_1V1/);
for (const mode of ['AWP_ONLY','DEAGLE_ONLY','KNIFE_ONLY','HEADSHOT_ONLY','RANDOM_WEAPON','FIRST_TO_10','HIGH_STAKES']) assert.match(source, new RegExp(mode));
assert.match(source, /MODE_MODIFIER_CONFLICT/);
assert.match(source, /DUEL_FORMATS/);
console.log('duel modes policy: PASS');
