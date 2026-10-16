import assert from 'node:assert/strict';
import { calculateProfileCompletion, PROFILE_COMPLETION_REWARD_KEY } from '../lib/profile-completion.ts';

const itemState = (result) => Object.fromEntries(result.items.map((item) => [item.id, item.complete]));
const EMPTY = { avatar: false, friends: false, matches: false, achievement: false };

const scenarios = [
  { name: 'empty profile scores zero', input: { hasCustomAvatar: false, acceptedFriends: 0, finishedMatches: 0, achievements: 0 }, percent: 0, completed: 0, rewardUnlocked: false, expect: { ...EMPTY } },
  { name: 'avatar alone unlocks avatar task', input: { hasCustomAvatar: true, acceptedFriends: 0, finishedMatches: 0, achievements: 0 }, percent: 25, completed: 1, rewardUnlocked: false, expect: { ...EMPTY, avatar: true } },
  { name: 'exactly three friends unlocks friends task', input: { hasCustomAvatar: false, acceptedFriends: 3, finishedMatches: 0, achievements: 0 }, percent: 25, completed: 1, rewardUnlocked: false, expect: { ...EMPTY, friends: true } },
  { name: 'two friends do not count', input: { hasCustomAvatar: false, acceptedFriends: 2, finishedMatches: 0, achievements: 0 }, percent: 0, completed: 0, rewardUnlocked: false, expect: { ...EMPTY } },
  { name: 'first finished match unlocks match task', input: { hasCustomAvatar: false, acceptedFriends: 0, finishedMatches: 1, achievements: 0 }, percent: 25, completed: 1, rewardUnlocked: false, expect: { ...EMPTY, matches: true } },
  { name: 'first achievement unlocks achievement task', input: { hasCustomAvatar: false, acceptedFriends: 0, finishedMatches: 0, achievements: 1 }, percent: 25, completed: 1, rewardUnlocked: false, expect: { ...EMPTY, achievement: true } },
  { name: 'avatar and match score half', input: { hasCustomAvatar: true, acceptedFriends: 0, finishedMatches: 4, achievements: 0 }, percent: 50, completed: 2, rewardUnlocked: false, expect: { ...EMPTY, avatar: true, matches: true } },
  { name: 'avatar friends and match score 75', input: { hasCustomAvatar: true, acceptedFriends: 7, finishedMatches: 1, achievements: 0 }, percent: 75, completed: 3, rewardUnlocked: false, expect: { ...EMPTY, avatar: true, friends: true, matches: true } },
  { name: 'everything except friends scores 75', input: { hasCustomAvatar: true, acceptedFriends: 2, finishedMatches: 9, achievements: 2 }, percent: 75, completed: 3, rewardUnlocked: false, expect: { ...EMPTY, avatar: true, matches: true, achievement: true } },
  { name: 'full profile unlocks the reward', input: { hasCustomAvatar: true, acceptedFriends: 3, finishedMatches: 1, achievements: 1 }, percent: 100, completed: 4, rewardUnlocked: true, expect: { avatar: true, friends: true, matches: true, achievement: true } },
];

assert.equal(PROFILE_COMPLETION_REWARD_KEY, 'profile-completion-avatar-v1', 'reward key must stay stable for idempotency');

let failures = 0;
for (const scenario of scenarios) {
  try {
    const result = calculateProfileCompletion(scenario.input);
    assert.equal(result.percent, scenario.percent, 'percent');
    assert.equal(result.completed, scenario.completed, 'completed count');
    assert.equal(result.total, 4, 'total');
    assert.equal(result.rewardUnlocked, scenario.rewardUnlocked, 'rewardUnlocked');
    assert.deepEqual(itemState(result), scenario.expect, 'per-task flags');
    console.log(`PASS ${scenario.name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${scenario.name}: ${error.message}`);
  }
}

const structure = calculateProfileCompletion({ hasCustomAvatar: false, acceptedFriends: 0, finishedMatches: 0, achievements: 0 });
try {
  assert.equal(structure.items.length, 4, 'exactly four tasks');
  assert.equal(structure.items.reduce((sum, item) => sum + item.weight, 0), 100, 'weights sum to 100');
  assert.deepEqual([...structure.items].map((item) => item.weight), [25, 25, 25, 25], 'each task weighs 25');
  assert.deepEqual([...structure.items].map((item) => item.id).sort(), ['achievement', 'avatar', 'friends', 'matches'], 'task ids');
  console.log('PASS weighting structure');
} catch (error) {
  failures += 1;
  console.log(`FAIL weighting structure: ${error.message}`);
}

if (failures) {
  console.error(`Profile completion: ${scenarios.length + 1 - failures}/${scenarios.length + 1} PASS`);
  process.exit(1);
}
console.log(`Profile completion: ${scenarios.length + 1}/${scenarios.length + 1} PASS`);
