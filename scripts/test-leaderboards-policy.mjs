import assert from 'node:assert/strict';
const periods=['global','daily','weekly','seasonal'];
assert.deepEqual(periods,['global','daily','weekly','seasonal']);
const global=[{rating:1200,wins:2,losses:1,nickname:'B'},{rating:1200,wins:4,losses:1,nickname:'A'},{rating:1100,wins:9,losses:0,nickname:'C'}];
assert.deepEqual(global.slice().sort((a,b)=>b.rating-a.rating||b.wins-a.wins||a.losses-b.losses||a.nickname.localeCompare(b.nickname)).map(x=>x.nickname),['A','B','C']);
const weekly=[{wins:3,rating:1000,losses:2,nickname:'B'},{wins:5,rating:900,losses:5,nickname:'A'},{wins:3,rating:1200,losses:1,nickname:'C'}];
assert.deepEqual(weekly.slice().sort((a,b)=>b.wins-a.wins||a.losses-b.losses||b.rating-a.rating).map(x=>x.nickname),['A','C','B']);
console.log('leaderboards policy: PASS');
