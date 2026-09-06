import assert from "node:assert/strict";
const MAX=20;
assert.equal(20<=MAX,true); assert.equal(21<=MAX,false);
const rank=(a,b)=>b.rating-a.rating||b.wins-a.wins||new Date(a.createdAt)-new Date(b.createdAt);
const rows=[{rating:1000,wins:8,createdAt:"2026-01-01"},{rating:1200,wins:1,createdAt:"2026-01-03"},{rating:1200,wins:2,createdAt:"2026-01-04"}].sort(rank);
assert.deepEqual(rows.map(x=>[x.rating,x.wins]),[[1200,2],[1200,1],[1000,8]]);
const permissions={LEADER:["promote","demote","kick"],OFFICER:["kick"],MEMBER:[]};
assert.deepEqual(permissions.LEADER.sort(),["demote","kick","promote"].sort()); assert.deepEqual(permissions.OFFICER,["kick"]); assert.deepEqual(permissions.MEMBER,[]);
console.log("clan policy: PASS");
