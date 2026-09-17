import fs from "node:fs";
const profile=fs.readFileSync("app/profile/page.tsx","utf8");
const ru=fs.readFileSync("locales/ru.ts","utf8");
const checks=[
 ["profile tabs use responsive grid", /grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6/.test(profile)],
 ["profile tabs do not use horizontal overflow", !/overflow-x-auto/.test(profile)],
 ["matches tab uses locale key", /\$\{t\.matches\}/.test(profile)],
 ["achievements stat uses locale key", /t=\{t\.hubCards\.achievements\}/.test(profile)],
 ["russian map heading uses accusative", /chooseMap:"Выберите карту"/.test(ru)],
 ["own profile recent matches capped at five", /slice\(0,5\)/.test(profile)],
];
let failed=0; for(const [name,ok] of checks){console.log(`${ok?"PASS":"FAIL"} ${name}`); if(!ok) failed++;}
if(failed) process.exit(1);
console.log(`${checks.length}/${checks.length} PASS`);
