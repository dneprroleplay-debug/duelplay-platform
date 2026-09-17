import fs from 'node:fs';
import assert from 'node:assert/strict';

const maps = fs.readFileSync('lib/duel-maps.ts', 'utf8');
const claim = fs.readFileSync('app/api/server-manager/claim/route.ts', 'utf8');
const manager = fs.readFileSync('scripts/server-manager/server-manager.mjs', 'utf8');
const matchPage = fs.readFileSync('app/matches/[id]/page.tsx', 'utf8');

const checks = [
  ['central map catalog contains Workshop IDs', maps.includes('workshopId: "3070923343"') && maps.includes('workshopId?: string;')],
  ['claim route resolves the canonical map config', claim.includes('const mapConfig = getDuelMap(match.mapName);')],
  ['claim route rejects a map without Workshop ID', claim.includes('if (!mapConfig.workshopId) throw new Error("WORKSHOP_ID_MISSING");')],
  ['claim route returns Workshop ID and URL to manager', claim.includes('workshopId: mapConfig.workshopId') && claim.includes('workshopUrl: `https://steamcommunity.com/sharedfiles/filedetails/?id=${mapConfig.workshopId}`')],
  ['manager uses host_workshop_map for Workshop maps', manager.includes("['+map', 'de_dust2', '+host_workshop_map', workshopId]")],
  ['manager never guesses de_ name for custom maps', manager.includes('Workshop ID is required for custom duel map')],
  ['manager logs the Workshop ID used for startup', manager.includes('workshop=${workshopId}')],
  ['match page links users to the exact Workshop item', matchPage.includes('https://steamcommunity.com/sharedfiles/filedetails/?id=') && matchPage.includes('openWorkshopMap')],
  ['match page keeps Steam connect flow', matchPage.includes('steam://rungameid/730') && matchPage.includes('openServer')],
];
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
const failed = checks.filter(([, ok]) => !ok);
assert.equal(failed.length, 0, `${failed.length} Workshop launch checks failed`);
console.log(`\nAll ${checks.length} Workshop launch checks passed.`);
