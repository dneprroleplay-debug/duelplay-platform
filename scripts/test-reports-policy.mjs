import fs from 'node:fs';
const root = new URL('..', import.meta.url).pathname;
const route = fs.readFileSync(`${root}/app/api/reports/route.ts`, 'utf8');
const schema = fs.readFileSync(`${root}/prisma/schema.prisma`, 'utf8');
const checks = [
  ['POST rate limit is inside transaction', /prisma\.\$transaction\(async tx[\s\S]*enforceRateLimit\(tx, me\.id, "REPORT_CREATE"/],
  ['self-report blocked', /Cannot report yourself/],
  ['match participant protection', /NOT_MATCH_PARTICIPANT/],
  ['target must belong to match', /TARGET_NOT_IN_MATCH/],
  ['duplicate open report protection', /DUPLICATE_REPORT/],
  ['evidence size cap', /MAX_EVIDENCE_BYTES/],
  ['staff moderation gate', /isModeratorRole\(me\.role\)/],
  ['moderation transitions', /INVALID_TRANSITION/],
  ['audit create', /CREATE_REPORT/],
  ['audit update', /UPDATE_REPORT/],
  ['report status enum exists', /enum ReportStatus/],
];
let failed = 0;
for (const [name, re] of checks) { const ok = re.test(route + '\n' + schema); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) failed++; }
if (failed) process.exit(1);
console.log('Reports policy: PASS');
