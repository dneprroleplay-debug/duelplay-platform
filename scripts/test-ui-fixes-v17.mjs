import fs from "node:fs";
const global=fs.readFileSync("components/Common/GlobalUiI18n.tsx","utf8");
const header=fs.readFileSync("components/Header/Header.tsx","utf8");
const matchmaking=fs.readFileSync("components/Matchmaking/MatchmakingPanel.tsx","utf8");
const cases=fs.readFileSync("components/Cases/Cases.tsx","utf8");
const publicProfile=fs.readFileSync("app/profile/[nickname]/page.tsx","utf8");
const profileApi=fs.readFileSync("app/api/profile/[nickname]/route.ts","utf8");
const checks=[
 ["LIVE is protected", global.includes('"LIVE"')],
 ["W and L are protected", global.includes('"W", "L"')],
 ["malformed 1v1 labels are protected", global.includes("[xXхХсСcC]")],
 ["translation cache bumped to v12", global.includes("duelplay-i18n-cache-v12")],
 ["profile dropdown does not protect whole container", !header.includes('data-player-name className="relative"')],
 ["profile nickname remains protected", header.includes('<div data-player-name className="font-bold">{user.nickname}</div>')],
 ["custom matchmaking stake input", matchmaking.includes('type="number"') && matchmaking.includes('value={stake}')],
 ["case cards are horizontal", cases.includes('md:grid-cols-[minmax(260px,34%)_1fr]')],
 ["public profile recent matches are capped", profileApi.includes('.slice(0,5)')],
 ["public profile W/L values are protected", publicProfile.includes('data-no-i18n className={`grid h-8')],
];
let failed=0; for(const [name,ok] of checks){console.log(`${ok?"PASS":"FAIL"} ${name}`);if(!ok)failed++;}
if(failed)process.exit(1);console.log(`${checks.length}/${checks.length} PASS`);
