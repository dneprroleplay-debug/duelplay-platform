import assert from 'node:assert/strict';
function apply(state, winner){
  return {...state,totalDuels:state.totalDuels+1,wins:state.wins+(winner?1:0),losses:state.losses+(winner?0:1),winStreak:winner?state.winStreak+1:0,bestStreak:winner?Math.max(state.bestStreak,state.winStreak+1):state.bestStreak};
}
let s={totalDuels:0,wins:0,losses:0,winStreak:0,bestStreak:0};
s=apply(s,true);s=apply(s,true);s=apply(s,false);s=apply(s,true);
assert.deepEqual(s,{totalDuels:4,wins:3,losses:1,winStreak:1,bestStreak:2});
assert.equal(apply({...s,winStreak:4,bestStreak:4},false).winStreak,0);
console.log('streak policy: PASS');
