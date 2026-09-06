import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const critical = [
  'app/api/admin/route.ts',
  'app/api/admin/cases/route.ts',
  'app/api/admin/cases/items/route.ts',
  'app/api/admin/content/route.ts',
  'app/api/banners/route.ts',
  'app/api/deposit-promotions/route.ts',
  'app/api/creator/route.ts',
  'app/api/creator-payouts/route.ts',
  'app/api/disputes/route.ts',
  'app/api/events/route.ts',
  'app/api/feature-flags/route.ts',
  'app/api/holidays/route.ts',
  'app/api/platform-settings/route.ts',
  'app/api/promo-campaigns/route.ts',
  'app/api/promo-codes/route.ts',
  'app/api/referral-race/route.ts',
  'app/api/seasons/route.ts',
  'app/api/site-settings/route.ts',
  'app/api/tournaments/route.ts',
];
const failures=[];
for(const rel of critical){
  const s=fs.readFileSync(path.join(root,rel),'utf8');
  if(!/requireAdmin/.test(s)) failures.push(`${rel}: missing requireAdmin`);
  if(!/audit\(/.test(s)) failures.push(`${rel}: missing audit`);
}
const admin=fs.readFileSync(path.join(root,'lib/admin.ts'),'utf8');
if(!/prisma\.auditLog\.create/.test(admin)) failures.push('lib/admin.ts: audit does not persist AuditLog');
const schema=fs.readFileSync(path.join(root,'prisma/schema.prisma'),'utf8');
for(const field of ['action','targetType','targetId','payload','createdAt']) if(!new RegExp(`\\b${field}\\b`).test(schema.slice(schema.indexOf('model AuditLog'),schema.indexOf('model SecurityEvent')))) failures.push(`AuditLog missing ${field}`);
if(failures.length){console.error(failures.join('\n'));process.exit(1)}
console.log(`Audit policy: PASS (${critical.length} critical routes + schema)`);
