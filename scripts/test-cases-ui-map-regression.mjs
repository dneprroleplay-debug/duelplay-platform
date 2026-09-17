import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cases = readFileSync('components/Cases/Cases.tsx','utf8');
assert.match(cases, /mt-7 grid gap-4 md:grid-cols-3/, 'Cases page should use the compact 3-column layout');
assert.doesNotMatch(cases, /md:grid-cols-\[minmax\(260px,34%\)_1fr\]/, 'Cases page should not use the stretched row layout');
assert.match(cases, /roulette-fullscreen-v2/, 'Fullscreen roulette must remain enabled');
assert.match(cases, /roulette-item-large/, 'Fullscreen roulette item layout must remain enabled');

const games = readFileSync('components/Games/Games.tsx','utf8');
assert.match(games, /t\.chooseMap/, 'Map heading must come from the canonical English UI key');
assert.doesNotMatch(games, /<h2[^>]*data-no-i18n/, 'Map heading must remain translatable');

const terminology = readFileSync('lib/duelplay-terminology.ts','utf8');
assert.match(terminology, /"Choose a map": \{ RU: "Выберите карту", UA: "Обери карту", EN: "Choose a map", PL: "Wybierz mapę" \}/);

console.log('Cases layout + map heading regression: PASS');
