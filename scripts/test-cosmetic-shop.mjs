import assert from 'node:assert/strict';
const src = await import('../lib/cosmetic-shop.ts');
const rewards = await import('../lib/reward-only-cosmetics.ts');
assert.equal(src.normalizeCosmeticType('avatar'),'AVATAR');
assert.throws(()=>src.normalizeCosmeticType('WEAPON_DAMAGE'),/INVALID_COSMETIC_TYPE/);
assert.equal(src.validateCosmeticPrice('12.34567'),12.3457);
assert.throws(()=>src.validateCosmeticPrice(0),/INVALID_COSMETIC_PRICE/);
assert.throws(()=>src.validateCosmeticMetadata({damage:10}),/GAMEPLAY_COSMETIC_FORBIDDEN/);
assert.equal(src.scopedShopIdempotencyKey('u1','k'), 'shop:u1:k');
assert.notEqual(src.scopedShopIdempotencyKey('u1','k'),src.scopedShopIdempotencyKey('u2','k'));
console.log('cosmetic-shop: PASS');

for (const slug of rewards.REWARD_ONLY_COSMETIC_SLUGS) assert.equal(rewards.isRewardOnlyCosmetic({ slug }), true, `${slug} must be reward-only`);
assert.equal(rewards.isRewardOnlyCosmetic({ slug: "neon-frame", metadata: { nonPayToWin: true } }), false, "the $4.99 Neon Frame remains purchasable");
assert.equal(rewards.isRewardOnlyCosmetic({ slug: "future-frame", metadata: { source: "LEVEL" } }), true, "metadata-marked progression rewards are protected");
console.log('reward-only cosmetic policy: PASS');
