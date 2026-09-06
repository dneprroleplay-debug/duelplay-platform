import fs from 'node:fs';
const root = new URL('..', import.meta.url).pathname;
const files = ['lib/trust.ts','lib/match-lifecycle.ts','app/api/matches/[id]/result/route.ts','app/api/matches/[id]/local-test/route.ts'];
for (const f of files) {
  if (!fs.existsSync(root + '/' + f)) throw new Error(`missing ${f}`);
}
const trust = fs.readFileSync(root + '/lib/trust.ts','utf8');
if (!trust.includes('trustLevelFromScore')) throw new Error('trust levels missing');
if (!trust.includes('trustScore')) throw new Error('trust score missing');
for (const f of files.slice(1)) {
  const s=fs.readFileSync(root+'/'+f,'utf8');
  const rep=s.indexOf('reputation: { increment: 15 }');
  const rec=s.indexOf('recalculateTrust(tx, winnerId)');
  if (rep < 0 || rec < 0 || rep > rec) throw new Error(`trust recalculation precedes reputation update in ${f}`);
}
console.log('trust policy: PASS');
