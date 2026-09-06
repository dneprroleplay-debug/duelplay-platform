import assert from 'node:assert/strict';

const compatible = ({stake, requestedStake, rating, ownRating, ratingWindow}) =>
  Math.abs(stake - requestedStake) <= requestedStake * 0.10 && Math.abs(rating - ownRating) <= ratingWindow;

const rank = (rows, ownRating, requestedStake) => rows.slice().sort((a,b) => {
  const rd = Math.abs(a.rating-ownRating)-Math.abs(b.rating-ownRating);
  if (rd) return rd;
  return Math.abs(a.stake-requestedStake)-Math.abs(b.stake-requestedStake);
});

assert.equal(compatible({stake:3.2,requestedStake:3,rating:1100,ownRating:1000,ratingWindow:200}), true);
assert.equal(compatible({stake:3.4,requestedStake:3,rating:1100,ownRating:1000,ratingWindow:200}), false);
assert.equal(compatible({stake:3,requestedStake:3,rating:1250,ownRating:1000,ratingWindow:200}), false);
assert.deepEqual(rank([{id:'far',stake:3,rating:1150},{id:'near',stake:3.1,rating:1020}],1000,3).map(x=>x.id),['near','far']);
console.log('matchmaking policy: PASS');
