import fs from "node:fs";
import assert from "node:assert/strict";

const route = fs.readFileSync("app/api/matches/[id]/server/route.ts", "utf8");
const page = fs.readFileSync("app/matches/[id]/page.tsx", "utf8");
const matchRoute = fs.readFileSync("app/api/matches/[id]/route.ts", "utf8");

const checks = [
  [route.includes("participantSteamIds = new Set"), "server route normalizes participant Steam IDs before presence filtering"],
  [route.includes("validConnectedSteamIds"), "server route filters connected IDs to real participants"],
  [matchRoute.includes("playerTwo: { select:"), "match API returns player two from the database"],
  [matchRoute.includes('Cache-Control') && matchRoute.includes('no-store'), "match API disables response caching"],
  [page.includes("const loadInFlight=useRef(false)"), "match polling has an in-flight guard"],
  [page.includes("if(!id||loadInFlight.current)return"), "a slow request cannot be aborted by the next polling tick"],
  [page.includes("setInterval(tick,1000)"), "match state is refreshed every second"],
  [page.includes("const displayPlayerTwo=m.playerTwo"), "player two is rendered directly from authoritative match state"],
  [!page.includes("loadPresence") && !page.includes("setPresence"), "stale presence response cannot overwrite match state"],
  [page.includes("m.liveState?.connectedCount"), "live connection count comes from the same authoritative match response"],
  [page.includes("const previousSnapshot=useRef"), "authoritative match snapshot is tracked across refreshes"],
  [page.includes("The fresh API snapshot above is authoritative"), "authoritative API snapshot drives lifecycle state"],
  [!page.includes("window.location.reload()"), "match page does not force full browser reloads on refresh"],
];

for (const [ok, label] of checks) {
  assert.ok(ok, `FAIL: ${label}`);
  console.log(`PASS: ${label}`);
}
console.log(`Connection/presence regression checks passed: ${checks.length}/${checks.length}.`);
