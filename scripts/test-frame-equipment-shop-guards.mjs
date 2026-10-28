import assert from "node:assert/strict";
import fs from "node:fs";
import { REWARD_ONLY_COSMETIC_SLUGS, isRewardOnlyCosmetic } from "../lib/reward-only-cosmetics.ts";

const shop = fs.readFileSync("app/api/shop/route.ts", "utf8");
const ownProfile = fs.readFileSync("app/profile/page.tsx", "utf8");
const publicProfile = fs.readFileSync("app/profile/[nickname]/page.tsx", "utf8");
const inventoryApi = fs.readFileSync("app/api/profile/frame/route.ts", "utf8");
const ratingApi = fs.readFileSync("app/api/leaderboards/route.ts", "utf8");
const homeRankingApi = fs.readFileSync("app/api/ranking/route.ts", "utf8");
const socialApi = fs.readFileSync("app/api/social/route.ts", "utf8");
const shopPage = fs.readFileSync("app/shop/page.tsx", "utf8");
const avatar = fs.readFileSync("components/Common/FrameAvatar.tsx", "utf8");
const picker = fs.readFileSync("components/Profile/AvatarPicker.tsx", "utf8");
const css = fs.readFileSync("app/globals.css", "utf8");

for (const slug of REWARD_ONLY_COSMETIC_SLUGS) {
  assert.equal(isRewardOnlyCosmetic({ slug }), true, `${slug} must be protected from shop purchase`);
  assert.ok(shop.includes("isRewardOnlyCosmetic"), "shop POST must enforce reward-only policy on the server");
}
assert.equal(isRewardOnlyCosmetic({ slug: "neon-frame" }), false, "purchased Neon Frame must remain purchasable policy-wise");
assert.match(shop, /slug:\s*\{\s*notIn:\s*\[\.\.\.REWARD_ONLY_COSMETIC_SLUGS\]/, "reward-only frames are excluded from the shop catalog");
assert.match(avatar, /frame-glow frame-glow--\$\{frame!\.slug\}/, "shared avatar component overlays the equipped SVG resource");
assert.match(picker, /frame\?:\{slug:string;name:string;imageUrl:string\|null\}\|null/, "own-profile avatar picker accepts equipped frame data");
assert.match(picker, /frame\?\.imageUrl.*frame-glow frame-glow--\$\{frame\.slug\}/, "own-profile avatar picker overlays the equipped SVG frame");
assert.match(ownProfile, /frame=\{data\.equippedFrame\}/, "own profile passes equipped frame to avatar picker");
assert.match(publicProfile, /FrameAvatar.*frame=\{p\.equippedFrame\}/, "public profile uses shared framed avatar");
assert.match(inventoryApi, /cosmeticFrameImageUrl/, "frame inventory resolves a common frame image resource");
assert.match(ratingApi, /equippedFrameItem:/, "rating API returns equipped frame for mini avatars");
assert.match(homeRankingApi, /equippedFrameItem:/, "home ranking API returns equipped frame for mini avatars");
assert.match(socialApi, /cosmeticFrameImageUrl/, "social API returns effective frame resources for friends and rivals");
assert.match(shopPage, /t\.cosmeticTypes\[x\.type/, "shop item categories are localized");
for (const locale of ["RU", "UA", "EN", "PL"]) assert.match(shop, new RegExp(`${locale}:`), `missing ${locale} reward-purchase refusal localization`);
assert.match(css, /prefers-reduced-motion:\s*reduce/, "frame animations respect reduced motion preference");
for (const slug of ["neon-frame", ...REWARD_ONLY_COSMETIC_SLUGS]) {
  const image = slug === "neon-frame" ? "public/images/frames/neon-frame.svg" : `public/images/frames/${slug}.svg`;
  if (slug === "frame-profile-complete" || slug === "neon-frame" || slug.startsWith("frame-level-") || slug.startsWith("frame-neon-") || slug.startsWith("frame-electric-") || slug.startsWith("frame-inferno-")) assert.ok(fs.existsSync(image), `missing SVG resource: ${image}`);
}
console.log("Frame equipment and shop guards: PASS");
