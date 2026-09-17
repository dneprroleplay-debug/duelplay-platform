import fs from "node:fs";
import assert from "node:assert/strict";

const source = fs.readFileSync("scripts/server-manager/server-manager.mjs", "utf8");
for (const token of [
  "weaponModifier === 'GRENADE_ONLY'",
  "exec duelplay_grenade",
  "mp_buy_allow_guns 0",
  "mp_t_default_primary 0",
  "mp_ct_default_primary 0",
  "mp_t_default_secondary 0",
  "mp_ct_default_secondary 0",
  "mp_t_default_melee 0",
  "mp_ct_default_melee 0",
  "mp_t_default_grenades 0",
  "mp_ct_default_grenades 0",
  "ammo_grenade_limit_total 12",
  "ammo_grenade_limit_default 3",
  "ammo_grenade_limit_flashbang 3",
  "mp_weapons_allow_map_placed 0",
  "CONNECT_TIMEOUT_MS = Number(process.env.DUELPLAY_CONNECTION_TIMEOUT_MS || 5 * 60 * 1000)",
  "No player connected within 5 minutes",
]) assert.ok(source.includes(token), `FAIL: ${token}`);

assert.ok(source.includes('if (current) finalizePlayerLoadoutAfterConnect();'), 'FAIL: mode loadout must apply after first connected player');

const lifecycle = fs.readFileSync("lib/match-lifecycle.ts", "utf8");
assert.ok(lifecycle.includes("function normalizeSteamId(value: unknown)"), "FAIL: timeout path must normalize Steam IDs");
assert.ok(lifecycle.includes("const candidateSteamId = normalizeSteamId(connectedSteamId);"), "FAIL: candidate SteamID normalization missing");

const route = fs.readFileSync("app/api/matches/[id]/route.ts", "utf8");
assert.ok(route.includes("connection-timeout lifecycle failed"), "FAIL: expired match GET must not break the match page on lifecycle exception");


assert.ok(source.includes("weaponModifier === 'GRENADE_ONLY' || mode === 'GRENADE_ONLY'"), "FAIL: GRENADE_ONLY launch detection missing");
assert.ok(source.includes("'mp_weapons_allow_map_placed 0'"), "FAIL: GRENADE_ONLY rules must clear map weapons");
assert.ok(source.includes('connectedSteamIds.map(normalizeSteamId)'), "FAIL: manager timeout must normalize Steam IDs");
assert.ok(source.includes("command('mp_restartgame 1');"), "FAIL: grenade rules must restart after enforcement");
assert.ok(source.includes("'mp_t_default_grenades 0'"), "FAIL: grenade defaults must be plugin-managed");
assert.ok(source.includes("'mp_ct_default_grenades 0'"), "FAIL: grenade defaults must be plugin-managed");
assert.ok(source.includes("'ammo_grenade_limit_total 12'"), "FAIL: grenade total limit must be 12");
assert.ok(source.includes("'ammo_grenade_limit_default 3'"), "FAIL: default grenade limit must be 3");
assert.ok(source.includes("'ammo_grenade_limit_flashbang 3'"), "FAIL: flashbang limit must be 3");
assert.ok(source.includes("command('duelplay_grenade_only 1')"), "FAIL: GRENADE_ONLY plugin enable hook missing");
assert.ok(source.includes("command('duelplay_grenade_only 0')"), "FAIL: GRENADE_ONLY plugin disable hook missing");
assert.ok(fs.existsSync("scripts/cs2-plugins/DuelPlayGrenadeOnly/DuelPlayGrenadeOnly.csproj"), "FAIL: GRENADE_ONLY plugin project missing");
assert.ok(fs.existsSync("scripts/cs2-plugins/DuelPlayGrenadeOnly/DuelPlayGrenadeOnly.cs"), "FAIL: GRENADE_ONLY plugin source missing");

const matchPage = fs.readFileSync('app/matches/[id]/page.tsx', 'utf8');
assert.ok(matchPage.includes('>START</button>'), "FAIL: match START button must remain untranslated");

console.log("GRENADE_ONLY + LIVE 5m technical-win regression: PASS");
