import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const source = (p) => fs.readFileSync(path.join(root, p), "utf8");
const policy = await import(pathToFileURL(path.join(root, "scripts/server-manager/mode-policy.mjs")).href);

const MONEY_LESS_MODES = ["AWP_ONLY", "DEAGLE_ONLY", "KNIFE_ONLY", "RANDOM_WEAPON", "GRENADE_ONLY"];
const OPEN_MODES = ["SOLO_1V1", "HEADSHOT_ONLY", "FIRST_TO_10"];
const ALL_MODES = [...MONEY_LESS_MODES, ...OPEN_MODES];
const FIXED_RANDOM_WEAPON = { weapon: "weapon_awp", slot: "primary", category: "rifles" };

// The CS2 console keeps the last value of a repeated cvar, so the effective
// value of a rule set is its last occurrence.
function finalValue(commands, key) {
  const matches = commands.filter((command) => command.startsWith(`${key} `));
  return matches.length ? matches[matches.length - 1].slice(key.length + 1) : null;
}

function rulesFor(mode) {
  return policy.buildDuelModeCommands(mode, null, FIXED_RANDOM_WEAPON);
}

// --- money-less modes ------------------------------------------------------
for (const mode of MONEY_LESS_MODES) {
  const rules = rulesFor(mode);
  assert.equal(policy.isMoneylessMode(mode), true, `${mode} is a money-less mode`);
  assert.equal(finalValue(rules, "mp_maxmoney"), "0", `${mode} caps the wallet at $0`);
  assert.equal(finalValue(rules, "mp_startmoney"), "0", `${mode} starts the match at $0`);
  assert.equal(finalValue(rules, "mp_afterroundmoney"), "0", `${mode} awards no round income`);
  assert.equal(finalValue(rules, "mp_buytime"), "0", `${mode} has no buy window`);
  assert.equal(finalValue(rules, "mp_buy_anywhere"), "0", `${mode} cannot buy outside a buy zone`);
  assert.equal(finalValue(rules, "mp_buy_allow_guns"), "0", `${mode} cannot buy guns`);
  assert.equal(finalValue(rules, "mp_buy_allow_grenades"), "0", `${mode} cannot buy grenades`);
  assert.equal(finalValue(rules, "mp_free_armor"), "2", `${mode} grants vest and helmet for free`);
  for (const rule of rules) {
    const money = rule.match(/^mp_(?:max|start|afterround)money\s+(\S+)$/);
    if (money) assert.equal(money[1], "0", `${mode} never sets a non-zero money value (${rule})`);
    assert.doesNotMatch(rule, /60000/, `${mode} never references $60000 (${rule})`);
  }
}

// --- modes with an economy --------------------------------------------------
assert.equal(finalValue(rulesFor("SOLO_1V1"), "mp_maxmoney"), "10000", "Classic keeps the $10,000 cap");
assert.equal(finalValue(rulesFor("SOLO_1V1"), "mp_afterroundmoney"), "0", "Classic keeps normal round income");
assert.equal(finalValue(rulesFor("HEADSHOT_ONLY"), "mp_maxmoney"), "10000", "Headshot keeps the $10,000 cap");
assert.equal(finalValue(rulesFor("HEADSHOT_ONLY"), "mp_buytime"), "15", "Headshot keeps the buy window");
assert.equal(finalValue(rulesFor("FIRST_TO_10"), "mp_maxmoney"), "10000", "FIRST_TO_10 keeps the $10,000 cap");
assert.equal(finalValue(rulesFor("FIRST_TO_10"), "mp_startmoney"), "10000", "FIRST_TO_10 still starts at $10,000");
assert.equal(finalValue(rulesFor("FIRST_TO_10"), "mp_afterroundmoney"), "10000", "FIRST_TO_10 still refills to $10,000");
assert.equal(finalValue(rulesFor("FIRST_TO_10"), "mp_buytime"), "15", "FIRST_TO_10 keeps the buy window");
assert.equal(finalValue(rulesFor("FIRST_TO_10"), "mp_free_armor"), "0", "FIRST_TO_10 keeps armor in the shop");
for (const mode of OPEN_MODES) {
  assert.equal(policy.isMoneylessMode(mode), false, `${mode} keeps its economy`);
}

// --- the runtime closure ----------------------------------------------------
const closure = policy.getMoneylessEconomyCommands();
for (const key of ["mp_maxmoney", "mp_startmoney", "mp_afterroundmoney"]) {
  const value = finalValue(closure, key);
  assert.equal(value, "0", `the runtime closure keeps ${key} at 0`);
}
for (const key of ["mp_buytime", "mp_buy_anywhere", "mp_buy_during_immunity", "mp_buy_allow_guns", "mp_buy_allow_grenades"]) {
  assert.equal(finalValue(closure, key), "0", `the runtime closure keeps ${key} at 0`);
}
assert.equal(finalValue(closure, "mp_free_armor"), "2", "the runtime closure grants vest and helmet");
assert.ok(closure.every((rule) => !/60000/.test(rule)), "the runtime closure never grants $60,000");

const buyZone = policy.getBuyZoneRemovalCommands();
assert.ok(buyZone.length > 0, "the buy zone removal is defined");
assert.ok(buyZone.every((rule) => /func_buyzone/.test(rule)), "the buy zone removal only targets func_buyzone");

// --- the server manager actually applies it ---------------------------------
const manager = source("scripts/server-manager/server-manager.mjs");
assert.match(manager, /isMoneylessMode/, "the manager imports the money-less mode check");
assert.match(manager, /getMoneylessEconomyCommands/, "the manager imports the economy closure");
assert.match(manager, /getBuyZoneRemovalCommands/, "the manager imports the buy zone removal");
assert.match(manager, /function enforceMoneylessEconomy\(\)[\s\S]*?isMoneylessMode\(current\.mode, current\.weaponModifier\)[\s\S]*?return;/, "the economy closure is skipped for modes with an economy");
assert.match(manager, /function closeMoneylessShop\(\)/, "the manager closes the shop for money-less modes");
assert.match(manager, /moneylessGuardTimer = setInterval\(\(\) => enforceMoneylessEconomy\(\), 500\)/, "the manager re-closes the economy on a timer while the match runs");
assert.match(manager, /if \(isMoneylessMode\(mode, weaponModifier\)\)/, "the money-less guard only starts for money-less modes");
assert.match(manager, /Round_Start[\s\S]{0,400}?closeMoneylessShop\(\)/, "the shop is closed again on every round start");
assert.match(manager, /Restart_Round[\s\S]{0,300}?closeMoneylessShop\(\)/, "the shop is closed again after a map round restart");
assert.match(manager, /finalizePlayerLoadoutAfterConnect\(\);\s*closeMoneylessShop\(\);/, "the shop is closed again when a player connects");
assert.match(manager, /if \(moneylessGuardTimer\) clearInterval\(moneylessGuardTimer\)/, "the money-less guard is stopped with the other match timers");

// --- the protected plugin stays untouched ------------------------------------
const plugin = source("scripts/cs2-plugins/DuelPlayGrenadeOnly/DuelPlayGrenadeOnly.cs");
assert.doesNotMatch(plugin, /mp_free_armor 2/, "the grenade plugin is not modified to grant armor");
assert.match(plugin, /private static readonly bool Diagnostics = true;/, "the grenade plugin keeps its temporary diagnostics");
assert.match(plugin, /\("mp_maxmoney", 0\)/, "the grenade plugin keeps its own closed economy re-assertion");

console.log("Money-less economy: PASS");
