import fs from "node:fs";
import assert from "node:assert/strict";

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const profile = read("app/profile/[nickname]/page.tsx");
const shop = read("app/shop/page.tsx");
const hub = read("app/hub/page.tsx");
const globalI18n = read("components/Common/GlobalUiI18n.tsx");

assert.match(profile, /data-no-i18n className=\{`grid h-8/);
assert.match(globalI18n, /"W", "L"/);
assert.doesNotMatch(shop, /<option data-no-i18n key=\{x\}/);
assert.match(shop, /t\.cosmeticTypes\[x as keyof typeof t\.cosmeticTypes\]/);
assert.doesNotMatch(hub, /creatorHub/);
assert.doesNotMatch(hub, /operations.*\/admin\/operations/);
console.log("Public UI translation rules: PASS");
