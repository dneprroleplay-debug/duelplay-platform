import fs from 'node:fs';

const admin = fs.readFileSync('app/api/admin/route.ts', 'utf8');

const checks = [
  ['admin imports shared cancel/refund lifecycle', admin.includes('import { cancelMatchWithRefund } from "@/lib/match-lifecycle";')],
  ['admin cancel accepts LIVE recovery path', admin.includes('if(matchBefore.status!=="CANCELLED"){') && admin.includes('await cancelMatchWithRefund(id, `Match cancelled by admin ${me.nickname}`);')],
  ['admin releases assigned server', admin.includes('where:{matchId:id}') && admin.includes('status:"OFFLINE"') && admin.includes('matchId:null')],
  ['finished/disputed matches remain protected', admin.includes('["FINISHED","DISPUTED"].includes(matchBefore.status)')],
];

for (const [name, ok] of checks) {
  if (!ok) throw new Error(`FAIL ${name}`);
  console.log(`PASS ${name}`);
}
console.log('Admin cancel policy checks passed.');
