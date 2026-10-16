import fs from "node:fs";

const page = fs.readFileSync("app/matches/[id]/page.tsx", "utf8");
const header = fs.readFileSync("components/Header/Header.tsx", "utf8");

const checks = [
  ["READY countdown uses persisted startDeadlineAt", page.includes('m.status==="READY"&&m.startDeadlineAt')],
  ["LIVE countdown uses persisted liveDeadlineAt", page.includes('m.liveDeadlineAt')],
  ["Countdown has a 1-second interval", page.includes('setInterval(tick,1000)')],
  ["Match start is server-driven (STARTING phase)", page.includes('m.status==="STARTING"')],
  ["Match has no manual START button", !page.includes('u.start')],
  ["Outside overlay closes menus", header.includes('cursor-default bg-transparent" onClick={closeMenus}')],
  ["Create duel exists in mobile menu", header.includes('href="/create"') && header.includes('{t.create}')],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} - ${name}`);
  if (!ok) failed++;
}
if (failed) process.exit(1);
console.log(`ui/match fixes: ${checks.length}/${checks.length} PASS`);
