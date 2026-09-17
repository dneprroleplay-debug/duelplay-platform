import fs from 'node:fs';
const route = fs.readFileSync('app/api/admin/revenue/route.ts','utf8');
const schema = fs.readFileSync('prisma/schema.prisma','utf8');
const checks = [
  ['admin guard', /requireAdmin\(3\)/.test(route)],
  ['completed transactions only', /status:\s*"COMPLETED"/.test(route)],
  ['date range', /createdAt:\s*\{\s*gte:\s*from,\s*lte:\s*to\s*\}/.test(route)],
  ['commission', route.includes('COMMISSION')],
  ['cases', route.includes('CASE_OPEN')],
  ['prime', route.includes('PRIME_PURCHASE')],
  ['duelpass', route.includes('DUELPASS_PURCHASE')],
  ['event pass', route.includes('EVENTPASS_PURCHASE')],
  ['xp boosters', route.includes('XP_BOOSTER_PURCHASE')],
  ['creator/referral expense', route.includes('REFERRAL')],
  ['tournament prizes', route.includes('TOURNAMENT_PRIZE')],
  ['daily breakdown', route.includes('daily: [...days.entries()]')],
  ['net revenue', route.includes('netRevenue: revenue - expenses')],
  ['transaction enum contains event pass', schema.includes('EVENTPASS_PURCHASE')],
];
let failed=0; for (const [name,ok] of checks) { console.log(`${ok?'PASS':'FAIL'} ${name}`); if(!ok) failed++; }
if(failed) process.exit(1);
