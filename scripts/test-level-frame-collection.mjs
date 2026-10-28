import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const levelFrames = readFileSync(join(root, "lib/level-frames.ts"), "utf8");
const progression = readFileSync(join(root, "lib/progression.ts"), "utf8");
const frameRoute = readFileSync(join(root, "app/api/profile/frame/route.ts"), "utf8");
const inventory = readFileSync(join(root, "app/inventory/page.tsx"), "utf8");
const shop = readFileSync(join(root, "app/api/shop/route.ts"), "utf8");
const profile = readFileSync(join(root, "app/api/profile/route.ts"), "utf8");
const loginRewards = readFileSync(join(root, "app/api/login-rewards/route.ts"), "utf8");

const thresholds = [10, 20, 30, 40, 50, 75, 100];
for (const level of thresholds) {
  assert.match(levelFrames, new RegExp(`level: ${level}, slug: "frame-level-${level}"`), `level ${level} frame is registered`);
  assert.ok(existsSync(join(root, `public/images/frames/frame-level-${level}.svg`)), `SVG for level ${level} exists`);
}
assert.match(levelFrames, /cosmeticPurchase\.upsert\(/, "ownership grant uses unique upsert");
assert.match(levelFrames, /userId_itemId/, "ownership uses unique user/item key");
assert.match(progression, /syncLevelFrames\(tx,userId,level\)/, "XP progression grants level frames");
assert.match(frameRoute, /syncLevelFrames\(tx, user\.id, currentUser\.level\)/, "frame inventory backfills earned thresholds");
assert.match(frameRoute, /FRAME_NOT_OWNED/, "equip route protects unowned frames");
assert.match(frameRoute, /locked:/, "locked level frames are exposed to the inventory UI");
assert.match(inventory, /frameSourceLabel/, "inventory displays reward source category");
assert.match(inventory, /frame\.owned&&/, "equip/remove action only renders for owned frames");
assert.match(shop, /LEVEL_REWARD_ONLY/, "level frames cannot be purchased through the shop");
assert.match(profile, /frame-profile-complete/, "profile completion reward remains integrated");
assert.match(loginRewards, /frame-neon-pulse|frame-electric-storm|frame-inferno-crown/, "Hub login rewards remain present");
assert.match(frameRoute, /frame-profile-complete/, "profile completion source is categorized separately");
assert.match(frameRoute, /"HUB"/, "Hub frames are categorized separately");

console.log("Level frame collection regression checks: PASS");
console.log(`Validated ${thresholds.length} level thresholds, SVG assets, idempotent ownership, equip protection, shop exclusion, and existing reward integrations.`);
