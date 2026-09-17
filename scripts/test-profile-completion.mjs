import assert from 'node:assert/strict';

function calculate({hasCustomAvatar, acceptedFriends, finishedMatches, achievements}) {
  const items = [
    { id: 'avatar', weight: 25, complete: hasCustomAvatar },
    { id: 'friends', weight: 25, complete: acceptedFriends >= 3 },
    { id: 'matches', weight: 25, complete: finishedMatches >= 1 },
    { id: 'achievement', weight: 25, complete: achievements >= 1 },
  ];
  const percent = items.reduce((sum, item) => sum + (item.complete ? item.weight : 0), 0);
  return { percent, completed: items.filter(x => x.complete).length, total: items.length, rewardUnlocked: percent >= 100 };
}

assert.equal(calculate({hasCustomAvatar:false,acceptedFriends:0,finishedMatches:0,achievements:0}).percent, 0);
assert.equal(calculate({hasCustomAvatar:true,acceptedFriends:0,finishedMatches:0,achievements:0}).percent, 25);
assert.equal(calculate({hasCustomAvatar:true,acceptedFriends:3,finishedMatches:1,achievements:0}).percent, 75);
assert.equal(calculate({hasCustomAvatar:true,acceptedFriends:5,finishedMatches:10,achievements:1}).percent, 100);
assert.equal(calculate({hasCustomAvatar:true,acceptedFriends:2,finishedMatches:1,achievements:1}).rewardUnlocked, false);
assert.equal(calculate({hasCustomAvatar:true,acceptedFriends:3,finishedMatches:1,achievements:1}).rewardUnlocked, true);
console.log('Profile completion: 6/6 PASS');
