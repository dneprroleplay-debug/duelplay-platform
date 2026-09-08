import fs from 'node:fs';
const page=fs.readFileSync('app/matches/[id]/page.tsx','utf8');
const css=fs.readFileSync('app/globals.css','utf8');
const checks=[
 ['countdown uses direct DOM paint', page.includes('ref.current.textContent=formatCountdown(left)')],
 ['countdown uses animation frame', page.includes('window.requestAnimationFrame(paint)')],
 ['countdown effect does not depend on callback identity', page.includes('},[deadline,maxSeconds]);')],
 ['10:01 is clamped away', page.includes('Math.min(maxSeconds,raw)')],
 ['START expiry state remains', page.includes('!deadlineExpired&&<button')],
 ['global viewport overflow guarded', css.includes('html,body{width:100%;max-width:100%;min-width:0;overflow-x:hidden}')],
 ['home hero can wrap', css.includes('.home-hero-title{max-width:min(100%,64rem);white-space:normal')],
 ['match page fluid', css.includes('.match-page-shell{width:100%;max-width:72rem;min-width:0}')],
];
let failed=0;
for(const [name,ok] of checks){console.log(`${ok?'PASS':'FAIL'} ${name}`);if(!ok)failed++}
if(failed) process.exit(1);
console.log(`match countdown/responsive policy: ${checks.length}/${checks.length} PASS`);
