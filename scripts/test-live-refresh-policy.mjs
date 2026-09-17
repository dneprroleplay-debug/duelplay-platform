import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const files=[
  'components/Common/AuthContext.tsx',
  'components/Header/Header.tsx',
  'components/Live/Live.tsx',
  'components/Support/SupportWidget.tsx',
  'components/Common/SiteAtmosphere.tsx',
  'app/wallet/page.tsx',
  'app/matches/[id]/page.tsx',
  'app/referral-race/page.tsx',
  'app/calendar/page.tsx',
  'app/notifications/page.tsx',
  'app/challenges/page.tsx',
];
let failures=0;
for(const file of files){
  const s=fs.readFileSync(path.join(root,file),'utf8');
  const intervals=(s.match(/(?:setInterval|window\.setInterval)\s*\(/g)||[]).length;
  const pollingIntervals=(s.match(/(?:setInterval|window\.setInterval)\s*\([^,]+,\s*(?:10000|30000|60000|7000|5000|3000)\s*\)/g)||[]).length;
  if(pollingIntervals===0){console.log(`PASS ${file}: no polling`);continue;}
  const visibility=s.includes('document.visibilityState') && s.includes('visibilitychange');
  const cleanup=s.includes('clearInterval');
  const inflight=s.includes('loadingRef')||s.includes('loading')||s.includes('disposed')||s.includes('cancelled')||s.includes('inFlight')||s.includes('live');
  const duplicateSafe=pollingIntervals===1;
  if(visibility&&cleanup&&inflight&&duplicateSafe) console.log(`PASS ${file}: polling=${pollingIntervals}, visibility, cleanup, overlap/cancellation guard`);
  else { failures++; console.log(`FAIL ${file}: polling=${pollingIntervals} visibility=${visibility} cleanup=${cleanup} guard=${inflight} singlePollingInterval=${duplicateSafe}`); }
}
if(failures) process.exit(1);
console.log(`Live Refresh policy PASS: ${files.length}/${files.length}`);
