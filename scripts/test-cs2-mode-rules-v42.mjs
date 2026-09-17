import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manager = readFileSync('scripts/server-manager/server-manager.mjs', 'utf8');
const modes = readFileSync('lib/duel-modes.ts', 'utf8');

for (const mode of ['SOLO_1V1','AWP_ONLY','DEAGLE_ONLY','KNIFE_ONLY','HEADSHOT_ONLY','RANDOM_WEAPON','FIRST_TO_10','GRENADE_ONLY']) {
  assert.match(modes, new RegExp(mode), `missing mode ${mode}`);
}
for (const token of ["weaponModifier === 'AWP_ONLY' || mode === 'AWP_ONLY'", "weaponModifier === 'DEAGLE_ONLY' || mode === 'DEAGLE_ONLY'", "weaponModifier === 'KNIFE_ONLY' || mode === 'KNIFE_ONLY'", "weaponModifier === 'HEADSHOT_ONLY' || mode === 'HEADSHOT_ONLY'", "weaponModifier === 'RANDOM_WEAPON' || mode === 'RANDOM_WEAPON'", "mode === 'FIRST_TO_10'", "weaponModifier === 'GRENADE_ONLY' || mode === 'GRENADE_ONLY'"]) assert.ok(manager.includes(token), `manager missing rule: ${token}`);

for (const token of [
  "exec duelplay_awp",
  "exec duelplay_deagle",
  "exec duelplay_knife",
  "exec duelplay_headshot",
  "exec duelplay_grenade",
  "mp_damage_headshot_only 1",
  "mp_t_default_secondary weapon_deagle",
  "mp_ct_default_secondary weapon_deagle",
  "mp_t_default_melee weapon_knife",
  "mp_ct_default_melee weapon_knife",
  "randomWeaponForDuel",
  "mp_maxrounds 19",
  "mp_match_can_clinch 1",
  "FIRST_TO_10 reached",
  "CONNECT_TIMEOUT_MS = Number(process.env.DUELPLAY_CONNECTION_TIMEOUT_MS || 5 * 60 * 1000)",
]) assert.ok(manager.includes(token), `missing rule: ${token}`);

for (const forbidden of ['HIGH_STAKES']) assert.ok(!modes.includes(forbidden), `${forbidden} must remain removed`);

console.log('V42 CS2 mode rules: PASS');
