import assert from 'node:assert/strict';
const next=(a,s)=>a==='start'&&s==='PENDING'?'ACTIVE':a==='finish'&&s==='ACTIVE'?'FINISHED':a==='cancel'&&(s==='PENDING'||s==='ACTIVE')?'CANCELLED':null;
assert.equal(next('start','PENDING'),'ACTIVE');
assert.equal(next('finish','ACTIVE'),'FINISHED');
assert.equal(next('cancel','PENDING'),'CANCELLED');
assert.equal(next('cancel','ACTIVE'),'CANCELLED');
assert.equal(next('finish','PENDING'),null);
assert.equal(next('start','FINISHED'),null);
console.log('clan wars policy: PASS');
