import fs from "node:fs";
import assert from "node:assert/strict";

const catalog = fs.readFileSync("lib/duel-maps.ts", "utf8");
const requiredMaps = [
  ["aim_redline", "Aim Redline", "aim_redline"],
  ["aim_dust2", "Aim Dust2", "aim_dust2"],
  ["pool_day", "Pool Day (Classic)", "fy_pool_day"],
  ["one_v_one_aim_map", "1v1 Aim Map", "1v1_map"],
  ["minecraft_aim_map", "Aim Map Minecraft", "de_minecraft_aim_map"],
  ["aim_cache", "AIM Cache", "aim_cache"],
  ["fy_snow", "Fy Snow", "fy_snow"],
  ["one_vs_one_aim_map_arena", "1vs1 Aim Map Arena", "1vs1_aim_map_arena"],
  ["one_v_one_anubis_aim", "1v1 Anubis Aim", "1v1_de_anubis_aim"],
  ["aim_halloween_1v1", "Aim Halloween 1v1", "aim_halloween"],
];
for (const [id, label, serverName] of requiredMaps) {
  assert.match(catalog, new RegExp(`id: "${id}"`));
  assert.match(catalog, new RegExp(`displayName: "${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.match(catalog, new RegExp(`serverMapName: "${serverName}"`));
}
for (const mode of ["SOLO_1V1", "AWP_ONLY", "DEAGLE_ONLY", "KNIFE_ONLY", "HEADSHOT_ONLY", "RANDOM_WEAPON", "FIRST_TO_10", "GRENADE_ONLY"]) {
  assert.match(catalog, new RegExp(`\\b${mode}: boolean;`));
}
const integrations = {
  create: fs.readFileSync("components/CreateMatch/CreateMatch.tsx", "utf8"),
  matchmaking: fs.readFileSync("components/Matchmaking/MatchmakingPanel.tsx", "utf8"),
  matchApi: fs.readFileSync("app/api/matches/route.ts", "utf8"),
  matchmakingApi: fs.readFileSync("app/api/matchmaking/route.ts", "utf8"),
  profile: fs.readFileSync("app/profile/page.tsx", "utf8"),
  live: fs.readFileSync("components/Live/Live.tsx", "utf8"),
};
assert.match(integrations.create, /DUEL_MAPS/);
assert.match(integrations.create, /isMapModeSupported/);
assert.match(integrations.matchmaking, /DUEL_MAPS/);
assert.match(integrations.matchmaking, /isMapModeSupported/);
assert.match(integrations.matchApi, /getDuelMap/);
assert.match(integrations.matchApi, /MODE_NOT_SUPPORTED_FOR_MAP/);
assert.match(integrations.matchmakingApi, /isMapModeSupported/);
assert.match(integrations.profile, /getDuelMap\(m\.mapName\)/);
assert.match(integrations.live, /DUEL_MAPS/);

const mapBody = catalog.slice(catalog.indexOf("export const DUEL_MAPS"), catalog.indexOf("export const DUEL_MAP_IDS"));
const catalogMaps = [...mapBody.matchAll(/\{\s*id: "([^"]+)"([\s\S]*?)\n  \},/g)].map(([, id, body]) => ({
  id,
  displayName: body.match(/displayName: "([^"]+)"/)?.[1] ?? null,
  serverMapName: body.match(/serverMapName: "([^"]+)"/)?.[1] ?? null,
  workshopId: body.match(/workshopId: "([^"]+)"/)?.[1] ?? null,
}));
assert.equal(catalogMaps.length, 10, "the canonical catalog has exactly ten maps");

// The setup document must mirror the catalog: its active table lists the exact
// same maps and Workshop IDs, and any removed maps live in a separate archive
// section so they cannot be mistaken for selectable maps.
function parseMapTable(section) {
  const rows = [];
  const rowPattern = /^\|\s*([^|]+?)\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|\s*$/gm;
  let match;
  while ((match = rowPattern.exec(section))) rows.push({ label: match[1].trim(), serverMapName: match[2].trim(), workshopId: match[3].trim() });
  return rows;
}

const setupDoc = fs.readFileSync("DUELPLAY_MAPS_SETUP.md", "utf8");
const archivedSplit = setupDoc.split(/^## Archived maps/m);
assert.equal(archivedSplit.length, 2, "the setup doc separates active maps from an archived maps section");
const activeRows = parseMapTable(archivedSplit[0]);
const archivedRows = parseMapTable(archivedSplit[1]);
assert.equal(activeRows.length, 10, "the setup doc must list exactly ten active maps");
for (const row of activeRows) {
  const map = catalogMaps.find((entry) => entry.serverMapName === row.serverMapName);
  assert.ok(map, `setup doc map ${row.serverMapName} exists in the canonical catalog`);
  assert.equal(row.label, map.displayName, `setup doc label for ${row.serverMapName} matches the catalog display name`);
  assert.equal(row.workshopId, map.workshopId, `setup doc Workshop ID for ${row.serverMapName} matches the catalog`);
}
assert.deepEqual(
  new Set(activeRows.map((row) => row.serverMapName)),
  new Set(catalogMaps.map((map) => map.serverMapName)),
  "the active setup doc map set equals the canonical catalog set",
);
assert.deepEqual(
  new Set(activeRows.map((row) => row.workshopId)),
  new Set(catalogMaps.map((map) => map.workshopId)),
  "the active setup doc Workshop ID set equals the canonical catalog set",
);
const activeServerNames = new Set(activeRows.map((row) => row.serverMapName));
const catalogWorkshopIds = new Set(catalogMaps.map((map) => map.workshopId));
for (const row of archivedRows) {
  assert.ok(!activeServerNames.has(row.serverMapName), `archived map ${row.serverMapName} is not in the active list`);
  assert.ok(!catalogWorkshopIds.has(row.workshopId), `archived map ${row.serverMapName} is not in the canonical catalog`);
}
assert.ok(archivedRows.length > 0, "the archived section documents the removed maps");

console.log(`Duel map catalog regression: 17/17 PASS`);
console.log(`Duel map docs parity: ${activeRows.length} active maps match the catalog; ${archivedRows.length} archived maps excluded. PASS`);
