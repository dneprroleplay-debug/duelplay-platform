import fs from 'node:fs';
import assert from 'node:assert/strict';
import { buildMapLaunchArgs } from './server-manager/map-launch.mjs';

const maps = fs.readFileSync('lib/duel-maps.ts', 'utf8');
const claim = fs.readFileSync('app/api/server-manager/claim/route.ts', 'utf8');
const manager = fs.readFileSync('scripts/server-manager/server-manager.mjs', 'utf8');
const matchPage = fs.readFileSync('app/matches/[id]/page.tsx', 'utf8');

function customMapRejectedWithoutWorkshopId() {
  try {
    buildMapLaunchArgs('fy_pool_day', '');
    return false;
  } catch (error) {
    return /Workshop ID is required for custom duel map/.test(error.message);
  }
}

const checks = [
  ['central map catalog contains Workshop IDs', maps.includes('workshopId: "3070923343"') && maps.includes('workshopId?: string;')],
  ['claim route resolves the canonical map config', claim.includes('const mapConfig = getDuelMap(match.mapName);')],
  ['claim route rejects a map without Workshop ID', claim.includes('if (!mapConfig.workshopId) throw new Error("WORKSHOP_ID_MISSING");')],
  ['claim route returns Workshop ID and URL to manager', claim.includes('workshopId: mapConfig.workshopId') && claim.includes('workshopUrl: `https://steamcommunity.com/sharedfiles/filedetails/?id=${mapConfig.workshopId}`')],
  ['manager launches Workshop maps via host_workshop_map', buildMapLaunchArgs('fy_pool_day', '3070923343').join(' ') === '+map de_dust2 +host_workshop_map 3070923343' && manager.includes('buildMapLaunchArgs(match.mapName, workshopId)')],
  ['manager never guesses a de_ name for custom maps', customMapRejectedWithoutWorkshopId()],
  ['manager logs the Workshop ID used for startup', manager.includes('workshop=${workshopId}')],
  ['match page links users to the exact Workshop item', matchPage.includes('https://steamcommunity.com/sharedfiles/filedetails/?id=') && matchPage.includes('openWorkshopMap')],
  ['match page keeps Steam connect flow', matchPage.includes('steam://rungameid/730') && matchPage.includes('openServer')],
];
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
const failed = checks.filter(([, ok]) => !ok);
assert.equal(failed.length, 0, `${failed.length} Workshop launch checks failed`);
console.log(`\nAll ${checks.length} Workshop launch checks passed.`);
