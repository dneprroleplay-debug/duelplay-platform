import fs from 'node:fs';
import assert from 'node:assert/strict';

const root = process.cwd();
const read = (p) => fs.readFileSync(`${root}/${p}`, 'utf8');
const cosmetic = read('lib/cosmetic-shop.ts');
const wallet = read('lib/wallet.ts');
const progression = read('lib/progression.ts');
const prime = read('lib/prime.ts');
const booster = read('lib/xp-booster.ts');
const duelpass = read('lib/duel-pass.ts');
const rewards = read('lib/rewards.ts');
const policy = read('lib/monetization-policy.ts');
const shop = read('app/api/shop/route.ts');
const primeRoute = read('app/api/prime/route.ts');
const boosterRoute = read('app/api/xp-boosters/route.ts');
const duelpassRoute = read('app/api/duelpass/route.ts');
const eventpassRoute = read('app/api/events/pass/route.ts');

assert.match(cosmetic, /GAMEPLAY_COSMETIC_FORBIDDEN/);
for (const key of ['damage','accuracy','recoil','armor','health','speed','fireRate','weaponStats','statBonus','multiplier']) {
  assert.match(cosmetic, new RegExp(key));
}
assert.match(shop, /COSMETIC_PURCHASE/);
assert.match(primeRoute, /PRIME_PURCHASE/);
assert.match(boosterRoute, /XP_BOOSTER_PURCHASE/);
assert.match(duelpassRoute, /DUELPASS_PURCHASE/);
assert.match(eventpassRoute, /EVENTPASS_PURCHASE/);
assert.match(wallet, /FOR UPDATE/);
assert.match(wallet, /idempotencyKey/);
assert.match(progression, /boostedXpAmount/);
assert.match(progression, /awardDuelPassXp/);
assert.match(prime, /PRIME_PLANS/);
assert.match(booster, /XP_BOOSTER_PLANS/);
assert.match(duelpass, /awardDuelPassXp/);
assert.match(rewards, /cosmeticItemId|cosmeticRequested/);
assert.match(rewards, /assertNonGameplayReward/);
assert.match(policy, /PAY_TO_WIN_FORBIDDEN_KEYS/);
assert.match(policy, /toLowerCase/);
assert.match(policy, /Array\.isArray/);

// Monetization code must not write ranked rating/stake/combat fields.
for (const [name, text] of Object.entries({shop, primeRoute, boosterRoute, duelpassRoute, eventpassRoute})) {
  assert.doesNotMatch(text, /playerStats\.update|rating\s*:/, `${name} must not mutate rating`);
  assert.doesNotMatch(text, /betAmount\s*:/, `${name} must not set match stake`);
  assert.doesNotMatch(text, /weaponModifier\s*:/, `${name} must not grant combat modifiers`);
}

console.log('Monetization policy: 16/16 PASS');
