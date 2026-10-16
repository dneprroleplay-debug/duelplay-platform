import fs from 'node:fs';
import assert from 'node:assert/strict';
import { evaluateAndUnlockAchievements } from '../lib/achievements.ts';
import { levelFromXp } from '../lib/level.ts';

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}: ${error.message}`);
  }
}

function createTx({ user, stats, achievements, unlocked = [], kills = 0 }) {
  const state = { creates: [], notifications: [], updates: [], unlocked: [...unlocked] };
  const tx = {
    user: {
      findUnique: async () => (user ? { ...user } : null),
      update: async ({ data }) => { state.updates.push(data); return { ...user, ...data }; },
    },
    playerStats: { findUnique: async () => (stats ? { ...stats } : null) },
    matchPlayerStat: { aggregate: async () => ({ _sum: { kills } }) },
    achievement: { findMany: async () => achievements },
    userAchievement: {
      findMany: async ({ where }) => state.unlocked.filter(x => x.userId === where.userId).map(x => ({ achievementId: x.achievementId })),
      create: async ({ data }) => { state.creates.push(data); state.unlocked.push(data); return data; },
    },
    notification: { create: async ({ data }) => { state.notifications.push(data); return data; } },
  };
  return { tx, state };
}

const firstWin = { id: 'ach-first-win', name: 'First Blood', xpReward: 100, conditions: { kind: 'FIRST_WIN', target: 1 }, createdAt: new Date(0) };

// Section 1 - reward engine decides correctly from real transaction state.
await check('winner with a win unlocks FIRST_WIN', async () => {
  const { tx, state } = createTx({
    user: { id: 'u-winner', xp: 0, level: 0 },
    stats: { wins: 1, totalDuels: 1, winStreak: 1 },
    achievements: [firstWin],
  });
  const results = await evaluateAndUnlockAchievements(tx, 'u-winner', { matchId: 'm1', won: true, weapon: null });
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'ach-first-win');
  assert.equal(state.creates.length, 1);
  assert.equal(state.creates[0].achievementId, 'ach-first-win');
});

await check('loser with no win does not receive FIRST_WIN', async () => {
  const { tx, state } = createTx({
    user: { id: 'u-loser', xp: 0, level: 0 },
    stats: { wins: 0, totalDuels: 1, winStreak: 0 },
    achievements: [firstWin],
  });
  const results = await evaluateAndUnlockAchievements(tx, 'u-loser', { matchId: 'm1', won: false, weapon: null });
  assert.equal(results.length, 0);
  assert.equal(state.creates.length, 0);
});

await check('repeated evaluation does not create duplicates', async () => {
  const { tx, state } = createTx({
    user: { id: 'u-repeat', xp: 0, level: 0 },
    stats: { wins: 3, totalDuels: 3, winStreak: 3 },
    achievements: [firstWin],
  });
  await evaluateAndUnlockAchievements(tx, 'u-repeat', { matchId: 'm1', won: true });
  const second = await evaluateAndUnlockAchievements(tx, 'u-repeat', { matchId: 'm2', won: true });
  assert.equal(second.length, 0);
  assert.equal(state.creates.length, 1);
});

await check('TOTAL_DUELS unlocks from duel count regardless of result', async () => {
  const achievement = { id: 'ach-duels', name: '100 Duels', xpReward: 0, conditions: { kind: 'TOTAL_DUELS', target: 5 }, createdAt: new Date(0) };
  const ok = createTx({ user: { id: 'u-a', xp: 0, level: 0 }, stats: { wins: 2, totalDuels: 5, winStreak: 0 }, achievements: [achievement] });
  const no = createTx({ user: { id: 'u-b', xp: 0, level: 0 }, stats: { wins: 1, totalDuels: 4, winStreak: 0 }, achievements: [achievement] });
  const unlocked = await evaluateAndUnlockAchievements(ok.tx, 'u-a', { won: false });
  const locked = await evaluateAndUnlockAchievements(no.tx, 'u-b', { won: true });
  assert.equal(unlocked.length, 1);
  assert.equal(locked.length, 0);
});

await check('KNIFE_WIN requires a confirmed win AND a knife weapon', async () => {
  const achievement = { id: 'ach-knife', name: 'Knife Master', xpReward: 0, conditions: { kind: 'KNIFE_WIN', target: 1 }, createdAt: new Date(0) };
  const run = (won, weapon) => {
    const { tx } = createTx({ user: { id: 'u-k', xp: 0, level: 0 }, stats: { wins: 1, totalDuels: 1, winStreak: 1 }, achievements: [achievement] });
    return evaluateAndUnlockAchievements(tx, 'u-k', { won, weapon });
  };
  const win = await run(true, 'KNIFE_ONLY');
  const noWeapon = await run(true, null);
  const noWin = await run(false, 'KNIFE_ONLY');
  assert.equal(win.length, 1);
  assert.equal(noWeapon.length, 0);
  assert.equal(noWin.length, 0);
});

// Section 2 - wiring: the reward engine runs on REAL settlement paths only.
const read = (p) => fs.readFileSync(p, 'utf8');
const lifecycle = read('lib/match-lifecycle.ts');
const adminRoute = read('app/api/admin/route.ts');
const disputesRoute = read('app/api/disputes/route.ts');
const resultRoute = read('app/api/matches/[id]/result/route.ts');
const localTestRoute = read('app/api/matches/[id]/local-test/route.ts');
const achievementsApi = read('app/api/achievements/route.ts');
const achievementsPage = read('app/achievements/page.tsx');
const count = (haystack, needle) => haystack.split(needle).length - 1;

await check('CS2 referee result path still evaluates achievements', async () => {
  assert.ok(resultRoute.includes('evaluateAndUnlockAchievements(tx, winnerId'));
  assert.ok(resultRoute.includes('evaluateAndUnlockAchievements(tx, loserId'));
});

await check('technical-win path evaluates achievements after progress', async () => {
  assert.ok(lifecycle.includes('import { evaluateAndUnlockAchievements }'));
  assert.ok(lifecycle.includes('evaluateAndUnlockAchievements(tx, winnerId, { matchId: full.id, won: true'));
  assert.ok(lifecycle.indexOf('evaluateAndUnlockAchievements(tx') > lifecycle.indexOf('await updateMatchProgress(tx, winnerId, true)'));
});

await check('admin dispute resolution evaluates achievements after progress', async () => {
  assert.ok(adminRoute.includes('evaluateAndUnlockAchievements(tx,winnerId,{matchId:match.id,won:true'));
  assert.ok(adminRoute.indexOf('evaluateAndUnlockAchievements(tx') > adminRoute.indexOf('await updateMatchProgress(tx,winnerId,true)'));
  assert.ok(adminRoute.indexOf('evaluateAndUnlockAchievements(tx') > adminRoute.indexOf('if(match.economyMode==="DEMO")'));
});

await check('dispute decision path evaluates achievements after progress', async () => {
  assert.ok(disputesRoute.includes('evaluateAndUnlockAchievements(tx, winnerId, { matchId: match.id, won: true'));
  assert.ok(disputesRoute.indexOf('evaluateAndUnlockAchievements(tx') > disputesRoute.indexOf('await updateMatchProgress(tx, winnerId, true)'));
  assert.ok(disputesRoute.indexOf('evaluateAndUnlockAchievements(tx') > disputesRoute.indexOf('if (match.economyMode === "DEMO")'));
});

await check('DEMO/local-test flows are untouched', async () => {
  assert.equal(count(localTestRoute, 'evaluateAndUnlockAchievements'), 0);
});

await check('each REAL path awards winner and loser exactly once', async () => {
  assert.equal(count(lifecycle, 'evaluateAndUnlockAchievements(tx, winnerId, { matchId: full.id'), 1);
  assert.equal(count(lifecycle, 'evaluateAndUnlockAchievements(tx, loserId, { matchId: full.id'), 1);
  assert.equal(count(resultRoute, 'evaluateAndUnlockAchievements(tx,'), 2);
});

await check('achievement evaluation stays inside idempotent settlement guards', async () => {
  const within = (src, startAbs, endNeedle) => {
    const slice = src.slice(startAbs);
    const evalAt = slice.indexOf('evaluateAndUnlockAchievements(tx');
    const endAt = slice.indexOf(endNeedle);
    return evalAt > 0 && endAt > evalAt;
  };
  const lifecycleRealGuard = lifecycle.indexOf('if (!existing)', lifecycle.indexOf('const idem = `forfeit:'));
  assert.ok(lifecycleRealGuard > 0);
  assert.ok(within(lifecycle, lifecycleRealGuard, 'return tx.match.update({ where: { id: full.id }'));
  assert.ok(within(adminRoute, adminRoute.indexOf('if(!credited.idempotent){'), 'const updated=await tx.match.update('));
  assert.ok(within(disputesRoute, disputesRoute.indexOf('if (!credited.idempotent) {'), 'const updatedMatch = await tx.match.update('));
});

// Section 3 - KNIFE_WIN derives from the reliable Match.weaponModifier signal.
await check('knife REAL finished win counts toward KNIFE_WIN', async () => {
  assert.ok(achievementsApi.includes("weaponModifier: 'KNIFE_ONLY'"));
  assert.ok(achievementsApi.includes("economyMode: 'REAL'"));
  assert.ok(achievementsApi.includes("status: 'FINISHED'"));
  assert.ok(achievementsApi.includes('winnerId: me.id'));
  assert.match(achievementsApi, /Boolean\(knifeWin\), knifeWin \? 'KNIFE_ONLY' : null\)/);
});

await check('non-knife, cancelled or unfinished matches never count', async () => {
  assert.ok(!achievementsApi.includes("weapon: { contains: 'knife'"));
  assert.ok(achievementsApi.includes("weaponModifier: 'KNIFE_ONLY'"));
  assert.ok(achievementsApi.includes("status: 'FINISHED'"));
});

await check('referee result path derives the knife flag from match.weaponModifier', async () => {
  assert.match(resultRoute, /match\.weaponModifier === 'KNIFE_ONLY' \? 'KNIFE_ONLY'/);
});

await check('all REAL settlement paths derive the knife flag from match.weaponModifier', async () => {
  assert.match(lifecycle, /won: true, weapon: full\.weaponModifier === 'KNIFE_ONLY' \? 'KNIFE_ONLY' : null/);
  assert.match(adminRoute, /won:true,weapon:match\.weaponModifier==="KNIFE_ONLY"\?"KNIFE_ONLY":null/);
  assert.match(disputesRoute, /won: true, weapon: match\.weaponModifier === 'KNIFE_ONLY' \? 'KNIFE_ONLY' : null/);
});

// Section 4 - locked achievements never render as earned at 100%.
await check('locked achievement cannot render as a full unlocked bar', async () => {
  assert.ok(achievementsPage.includes("data-state={a.unlocked ? 'unlocked' : 'locked'}"));
  assert.ok(achievementsPage.includes('Math.min(percent, 99)'));
  assert.ok(achievementsPage.includes("a.unlocked ? 'bg-pink-400' : 'bg-zinc-600'"));
  assert.ok(achievementsPage.includes('🔒 Locked'));
});

// Section 5 - achievement XP uses the single canonical level formula (no +1 inflation).
await check('canonical levelFromXp boundaries clamp at 0 and 100', async () => {
  assert.equal(levelFromXp(0), 0);
  assert.equal(levelFromXp(99), 0);
  assert.equal(levelFromXp(100), 1);
  assert.equal(levelFromXp(399), 1);
  assert.equal(levelFromXp(400), 2);
  assert.equal(levelFromXp(9999), 9);
  assert.equal(levelFromXp(1000000), 100);
  assert.equal(levelFromXp(100000000), 100);
  assert.equal(levelFromXp(-50), 0);
});

await check('achievement XP writes the canonical level, never an inflated one', async () => {
  const cases = [
    { xp: 0, reward: 100 },
    { xp: 390, reward: 10 },
    { xp: 0, reward: 1000000 },
  ];
  for (const { xp, reward } of cases) {
    const achievement = { id: `ach-${xp}-${reward}`, name: 'Reward', xpReward: reward, conditions: { kind: 'FIRST_WIN', target: 1 }, createdAt: new Date(0) };
    const { tx, state } = createTx({
      user: { id: 'u-lvl', xp, level: levelFromXp(xp) },
      stats: { wins: 1, totalDuels: 1, winStreak: 1 },
      achievements: [achievement],
    });
    await evaluateAndUnlockAchievements(tx, 'u-lvl', { won: true });
    assert.equal(state.updates.length, 1);
    assert.equal(state.updates[0].xp, xp + reward);
    assert.equal(state.updates[0].level, levelFromXp(xp + reward));
    const inflated = Math.max(1, Math.min(100, Math.floor(Math.sqrt((xp + reward) / 100)) + 1));
    assert.ok(state.updates[0].level <= inflated, 'level must never exceed the old inflated formula');
  }
});

await check('achievement XP and progression share one canonical level function', async () => {
  const achievementsSrc = read('lib/achievements.ts');
  const progressionSrc = read('lib/progression.ts');
  assert.ok(achievementsSrc.includes("from './level.ts'"));
  assert.ok(progressionSrc.includes("from '@/lib/level'"));
  assert.ok(progressionSrc.includes('export { levelFromXp }'));
  assert.ok(!achievementsSrc.includes('Math.sqrt'));
  assert.ok(!progressionSrc.includes('Math.sqrt'));
});

console.log(`\nAchievements regressions: ${passed}/${passed + failed} PASS`);
if (failed) process.exit(1);
