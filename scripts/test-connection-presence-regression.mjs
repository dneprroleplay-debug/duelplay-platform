import fs from "node:fs";

const route = fs.readFileSync("app/api/matches/[id]/server/route.ts", "utf8");
const page = fs.readFileSync("app/matches/[id]/page.tsx", "utf8");

const checks = [
  [/\[U:1:/, "server route normalizes Steam3 IDs"],
  [/76561197960265728n/, "server route converts account IDs to Steam64"],
  [/participantSteamIds = new Set/, "participant IDs are normalized before filtering"],
  [/validConnectedSteamIds =/, "connected IDs are filtered against normalized participants"],
  [/presence\?\.liveState\?\.connectedCount/, "UI prefers fresh presence connection count"],
  [/setInterval\(tick,1000\)/, "UI polls presence every second"],
];
for (const [pattern, label] of checks) {
  if (!pattern.test(route + "\n" + page)) throw new Error(`FAIL: ${label}`);
  console.log(`PASS: ${label}`);
}
console.log("Connection presence regression checks passed.");
