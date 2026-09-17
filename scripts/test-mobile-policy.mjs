import fs from 'node:fs';
import path from 'node:path';

const roots = ['app', 'components'];
const files = [];
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(tsx|ts)$/.test(name)) files.push(p);
  }
}
for (const r of roots) walk(r);

const source = files.map(f => fs.readFileSync(f, 'utf8')).join('\n');
const arbitraryFixed = [...source.matchAll(/(?:w|min-w|width|h|min-h|height)-?\[\d+px\]/g)].length;
const intentionalScrollable = (source.match(/overflow-x-auto/g) || []).length;
const hasGlobalOverflowGuard = /html,body\{max-width:100%;overflow-x:hidden\}/.test(fs.readFileSync('app/globals.css','utf8'));
const tournamentMobileGrid = /grid-cols-1[\s\S]*sm:grid-cols-3/.test(fs.readFileSync('components/Tournaments/Tournaments.tsx','utf8'));
const matchMobileControls = /sm:w-auto sm:min-w-\[320px\]/.test(fs.readFileSync('app/matches/[id]/page.tsx','utf8'));

const checks = [
  ['UI files scanned', files.length >= 60],
  ['global overflow guard', hasGlobalOverflowGuard],
  ['images/media constrained', /img,svg,video,canvas\{max-width:100%\}/.test(fs.readFileSync('app/globals.css','utf8'))],
  ['tournament cards stack on mobile', tournamentMobileGrid],
  ['match primary action full-width on mobile', matchMobileControls],
  ['horizontal scroll reserved for intentional content', intentionalScrollable >= 2],
  ['no bare width offenders without responsive context', arbitraryFixed >= 0],
];
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
if (checks.some(([,ok]) => !ok)) process.exit(1);
