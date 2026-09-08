import fs from "node:fs";

const page = fs.readFileSync("app/matches/[id]/page.tsx", "utf8");
const header = fs.readFileSync("components/Header/Header.tsx", "utf8");

const checks = [
  ["READY countdown uses persisted startDeadlineAt", page.includes('m.status==="READY" && m.startDeadlineAt')],
  ["LIVE countdown uses persisted connectionDeadlineAt", page.includes('m.connectionDeadlineAt')],
  ["Countdown has a 1-second interval", page.includes('window.setInterval(update,1000)')],
  ["START label never becomes ellipsis", page.includes('{u.start}</button>') && !page.includes('{busy?"…":u.start}')],
  ["START is disabled at zero", page.includes('disabled={busy||secondsLeft===0}')],
  ["Outside overlay closes menus", header.includes('onPointerDown={closeMenus}')],
  ["Create duel exists in mobile menu", header.includes('href="/create"') && header.includes('Создать дуэль')],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} - ${name}`);
  if (!ok) failed++;
}
if (failed) process.exit(1);
console.log(`ui/match fixes: ${checks.length}/${checks.length} PASS`);
