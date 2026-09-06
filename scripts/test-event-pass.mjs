import fs from 'node:fs';
const files=['lib/event-pass.ts','app/api/events/pass/route.ts','app/events/page.tsx','lib/progression.ts','app/api/cases/route.ts','prisma/schema.prisma'];
for(const f of files){if(!fs.existsSync(f)) throw new Error(`missing ${f}`); const s=fs.readFileSync(f,'utf8'); if(!s.trim()) throw new Error(`empty ${f}`);}
const pass=fs.readFileSync('app/api/events/pass/route.ts','utf8');
for(const token of ['upgradePremium','eventPassClaim','grantReward','eventPassProgress','refreshEventMissionsForUser']) if(!pass.includes(token)) throw new Error(`missing ${token}`);
const helper=fs.readFileSync('lib/event-pass.ts','utf8');
for(const token of ['event-mission:','PLAY_DUELS','WINS','OPEN_CASE','STREAK','eventPassLevelForXp']) if(!helper.includes(token)) throw new Error(`missing ${token}`);
console.log('Event Pass static checks: PASS');
