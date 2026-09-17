import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const requiredMaps = [
  "aim_redline.png",
  "aim_dust2.png",
  "pool_day_classic.png",
  "one_v_one_aim_map.png",
  "one_v_one_remastered.png",
  "one_v_one_oasis.png",
  "one_v_one_v3.png",
  "one_v_one_arena.png",
  "one_v_one_anubis_aim.png",
  "aim_halloween_1v1.png",
];
const requiredCases = ["starter_case.png", "neon_duel_case.png", "premium_arsenal.png"];
const requiredItems = ["pistol_core.png", "emerald_fang.png", "azure_strike.png", "violet_pulse.png", "gold_reaper.png", "neon_wolf.png"];

function check(label, file) {
  const ok = fs.existsSync(path.join(root, file));
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: ${file}`);
  return ok;
}

let passed = 0;
let failed = 0;
for (const name of requiredMaps) (check("map image", `public/images/maps/${name}`) ? passed++ : failed++);
for (const name of requiredCases) (check("case image", `public/images/cases/${name}`) ? passed++ : failed++);
for (const name of requiredItems) (check("case item image", `public/images/case-items/${name}`) ? passed++ : failed++);

const home = fs.readFileSync(path.join(root, "app/page.tsx"), "utf8");
const homeNoGames = !home.includes('import Games from "../components/Games/Games"') && !home.includes("<Games ");
console.log(`${homeNoGames ? "PASS" : "FAIL"} home popular maps section removed`);
homeNoGames ? passed++ : failed++;

const maps = fs.readFileSync(path.join(root, "lib/duel-maps.ts"), "utf8");
const allCanonical = requiredMaps.every((name) => maps.includes(`/images/maps/${name}`));
console.log(`${allCanonical ? "PASS" : "FAIL"} duel map catalog references all supplied map images`);
allCanonical ? passed++ : failed++;

console.log(`Summary: ${passed} PASS, ${failed} FAIL`);
process.exitCode = failed ? 1 : 0;
