import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { grantLoginRewardFrame, syncLoginRewardFrameCatalog, LOGIN_REWARD_FRAME_CATALOG } from "../lib/login-reward-frames.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const route = fs.readFileSync(path.join(root, "app/api/login-rewards/route.ts"), "utf8");
const inventoryRoute = fs.readFileSync(path.join(root, "app/api/profile/frame/route.ts"), "utf8");
const inventoryPage = fs.readFileSync(path.join(root, "app/inventory/page.tsx"), "utf8");
const profileRoute = fs.readFileSync(path.join(root, "app/api/profile/route.ts"), "utf8");
const loginPage = fs.readFileSync(path.join(root, "app/login-rewards/page.tsx"), "utf8");
const seed = fs.readFileSync(path.join(root, "prisma/seed.ts"), "utf8");
const schema = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
const oldRewardTest = fs.readFileSync(path.join(root, "scripts/test-login-rewards-rewards.mjs"), "utf8");

const expected = new Map([[7, "frame-neon-pulse"], [15, "frame-electric-storm"], [30, "frame-inferno-crown"]]);
assert.equal(LOGIN_REWARD_FRAME_CATALOG.length, 3, "exactly three login-reward frames are catalogued");
const expectedAmounts = new Map([[7, 75], [15, 100], [30, 1000]]);
for (const [day, slug] of expected) {
  const def = LOGIN_REWARD_FRAME_CATALOG.find((frame) => frame.day === day);
  assert.ok(def, `day ${day} is defined in the frame catalog`);
  assert.equal(def.slug, slug, `day ${day} keeps its established slug`);
  assert.match(route, new RegExp(`\\{ day: ${day}, balance: ${expectedAmounts.get(day)}, cosmeticSlug: "${slug}" \\}`), `API calendar keeps the correct reward amount and slug for day ${day}`);
  assert.ok(fs.existsSync(path.join(root, "public", def.imageUrl.replace(/^\//, ""))), `day ${day} SVG asset exists`);
  const svg = fs.readFileSync(path.join(root, "public", def.imageUrl.replace(/^\//, "")), "utf8");
  assert.match(svg, /<svg[\s>]/, `day ${day} asset is an SVG image`);
}

// Exercise the production helper against a deterministic fake of the two Prisma
// unique-upsert boundaries. This is an in-memory unit test, not PostgreSQL.
const items = new Map();
const purchases = new Map();
let itemSequence = 0;
let purchaseSequence = 0;
const tx = {
  cosmeticItem: {
    async upsert(args) {
      const slug = args.where.slug;
      const existing = items.get(slug);
      const row = existing
        ? { ...existing, ...args.update }
        : { id: `item-${++itemSequence}`, ...args.create };
      items.set(slug, row);
      return { ...row };
    },
  },
  cosmeticPurchase: {
    async upsert(args) {
      const { userId, itemId } = args.where.userId_itemId;
      const key = `${userId}:${itemId}`;
      const existing = purchases.get(key);
      const row = existing ?? { id: `purchase-${++purchaseSequence}`, userId, itemId, ...args.create };
      purchases.set(key, row);
      return { ...row };
    },
  },
};

await syncLoginRewardFrameCatalog(tx);
assert.equal(items.size, 3, "catalog sync repairs all three system cosmetics");
assert.equal(purchases.size, 0, "catalog sync does not award unearned ownership");
for (const slug of expected.values()) {
  const item = items.get(slug);
  assert.equal(item.type, "FRAME", `${slug} is a FRAME`);
  assert.equal(item.active, true, `${slug} is active`);
  assert.equal(Number(item.price), 0, `${slug} remains a reward, not a purchase`);
  assert.ok(item.imageUrl, `${slug} points to a real preview asset`);
  assert.equal(item.metadata.source, "HUB", `${slug} source is DuelPlay Hub`);
}

for (const slug of expected.values()) {
  const first = await grantLoginRewardFrame(tx, "user-example", slug);
  const rowCountAfterFirst = purchases.size;
  const second = await grantLoginRewardFrame(tx, "user-example", slug);
  assert.equal(first.item.id, second.item.id, `${slug} keeps one catalog item identity`);
  assert.equal(first.purchase.id, second.purchase.id, `${slug} keeps one owned purchase identity`);
  assert.equal(purchases.size, rowCountAfterFirst, `${slug} repeat grant creates no duplicate ownership`);
}
assert.equal(purchases.size, 3, "three reward claims produce exactly three owned frames for one user");

// Source-level checks for transaction/idempotency integration with the real route.
assert.ok((route.match(/grantLoginRewardFrame\(tx, me\.id,/g) || []).length >= 2, "new and recovery claim paths both grant/backfill the cosmetic");
assert.match(route, /syncLoginRewardFrameCatalog\(tx\)/, "rewards page endpoint repairs missing catalog entries");
assert.match(route, /login-reward:\$\{row\.id\}/, "DEMO credit ledger retains the existing idempotency key");
assert.match(route, /existingToday/, "repeat daily requests use existing claim recovery path");
assert.match(route, /base\.cosmeticSlug === null/, "legacy reward rows with a missing/null frame slug can be recovered from the canonical day definition");
assert.match(route, /priorTransaction \? 0 : Number\(granted\.transaction\.amount\)/, "repeat requests do not report credits as newly granted");
assert.match(inventoryRoute, /syncLoginRewardFrameCatalog\(tx\)/, "existing frame inventory repairs item visuals/metadata");
assert.match(inventoryRoute, /FRAME_NOT_OWNED/, "frame equip endpoint still protects unowned frames");
assert.match(profileRoute, /syncLoginRewardFrameCatalog\(tx\)/, "profile API refreshes visuals for already-equipped legacy reward frames");
assert.match(inventoryPage, /frameSourceLabel/, "inventory keeps its source categories");
assert.match(loginPage, /reward\.frame\?\.imageUrl \|\| FRAME_IMAGE_FALLBACK\[slug\]/, "login day cards render API frame assets with local fallback");
for (const locale of ["RU", "UA", "EN", "PL"]) assert.match(loginPage, new RegExp(`${locale}: \\{ name:`), `${locale} frame title/description is localized`);
assert.match(seed, /syncLoginRewardFrameCatalog\(tx\)/, "seed repairs/activates reward item records without resetting claim history");
assert.match(schema, /@@unique\(\[userId,itemId\]\)/, "ownership relies on the existing unique user/item constraint");
assert.match(oldRewardTest, /frame-inferno-crown/, "existing 30-day reward amount/slug regression remains covered");

console.log("Login reward frame integration checks: PASS");
console.log("Verified 7/15/30 catalog mapping and SVG previews, active FRAME catalog repair, same-transaction idempotent ownership helper, recovery path, no duplicate purchase rows in a deterministic in-memory unit test, unchanged DEMO idempotency wiring, inventory equip guard, RU/UA/EN/PL presentation and existing 30-day calendar test coverage.");
console.log("PostgreSQL integration: NOT RUN by this test (the simulated tx uses in-memory Maps).");
