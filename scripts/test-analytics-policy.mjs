import assert from 'node:assert/strict';
const rows=[{kills:10,deaths:5,headshots:4,damage:500},{kills:20,deaths:10,headshots:10,damage:700}];
const kills=rows.reduce((n,x)=>n+x.kills,0),deaths=rows.reduce((n,x)=>n+x.deaths,0),hs=rows.reduce((n,x)=>n+x.headshots,0),damage=rows.reduce((n,x)=>n+x.damage,0);
assert.equal(kills,30);assert.equal(deaths,15);assert.equal(Number((kills/deaths).toFixed(2)),2);assert.equal(Number((hs/kills*100).toFixed(1)),46.7);assert.equal(Number((damage/rows.length).toFixed(1)),600);
const finishedOnly=[{status:'FINISHED'},{status:'LIVE'}].filter(x=>x.status==='FINISHED');assert.equal(finishedOnly.length,1);
console.log('analytics policy: PASS');
