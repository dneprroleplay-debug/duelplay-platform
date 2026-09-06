const base=process.env.QA_BASE_URL||'http://localhost:3000';
const paths=['/','/matches','/live','/cases','/rating','/profile','/hub','/challenges','/clans','/leagues','/analytics','/events','/seasons','/social','/referral-race','/tournaments','/inventory','/wallet','/prime','/duelpass','/xp-boosters','/shop','/creator','/disputes','/achievements','/missions','/login-rewards','/collections'];
let failed=0;for(const p of paths){try{const r=await fetch(base+p,{redirect:'manual'});if(r.status>=500){console.error('FAIL',p,r.status);failed++;}else console.log('OK',p,r.status);}catch(e){console.error('ERR',p,e.message);failed++;}}
process.exitCode=failed?1:0;
