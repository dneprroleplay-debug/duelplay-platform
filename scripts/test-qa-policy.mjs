import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const required = [
  'prisma/schema.prisma',
  'scripts/qa-local.mjs',
  'scripts/qa-syntax.mjs',
  'scripts/test-mobile-policy.mjs',
  'scripts/test-live-refresh-policy.mjs',
  'scripts/test-architecture-policy.mjs',
  'scripts/test-webhooks-policy.mjs',
  'scripts/test-steam-trade-policy.mjs',
  'scripts/test-monetization-policy.mjs',
];
let failed = 0;
for (const rel of required) {
  if (fs.existsSync(path.join(root, rel))) console.log(`PASS required QA asset: ${rel}`);
  else { console.error(`FAIL missing QA asset: ${rel}`); failed++; }
}

function countFiles(dir, re) {
  let n = 0;
  for (const name of fs.readdirSync(dir)) {
    if (['node_modules', '.next', '.git'].includes(name)) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) n += countFiles(p, re);
    else if (re.test(name)) n++;
  }
  return n;
}
const routeCount = countFiles(path.join(root, 'app/api'), /^route\.ts$/);
const pageCount = countFiles(path.join(root, 'app'), /^page\.tsx$/);
if (routeCount > 0) console.log(`PASS API route inventory: ${routeCount}`); else { console.error('FAIL no API routes found'); failed++; }
if (pageCount > 0) console.log(`PASS page inventory: ${pageCount}`); else { console.error('FAIL no pages found'); failed++; }

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const script of ['build','db:validate','qa:local','qa:syntax']) {
  if (typeof pkg.scripts?.[script] === 'string') console.log(`PASS package QA script: ${script}`);
  else { console.error(`FAIL missing package script: ${script}`); failed++; }
}

console.log(`QA static policy: ${failed ? 'FAIL' : 'PASS'}`);
process.exitCode = failed ? 1 : 0;
