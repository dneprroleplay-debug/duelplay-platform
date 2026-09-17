import fs from "node:fs";
import assert from "node:assert/strict";

const catalog = fs.readFileSync("lib/duel-maps.ts", "utf8");
const requiredMaps = [
  ["aim_redline", "Aim Redline", "aim_redline"],
  ["aim_dust2", "Aim Dust2", "aim_dust2"],
  ["pool_day", "Pool Day (Classic)", "fy_pool_day"],
  ["one_v_one_aim_map", "1v1 Aim Map", "1v1_map"],
  ["one_v_one_remastered", "1v1 - Remastered", "1v1_remastered"],
  ["one_v_one_oasis", "1v1 Oasis", "1v1_oasis"],
  ["one_v_one_v3", "1v1 v3", "1v1_v3"],
  ["one_v_one_arena", "1v1 Arena", "1v1_arena"],
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
console.log("Duel map catalog regression: 17/17 PASS");
