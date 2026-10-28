import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { THEMES, themeById } from "../lib/themes.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const banner = read("components/Common/ProfileBanner.tsx");
const css = read("app/globals.css");
const themeProvider = read("components/Common/ThemeProvider.tsx");
const rating = read("app/rating/page.tsx");
const leaderboard = read("app/api/leaderboards/route.ts");
const ownProfile = read("app/profile/page.tsx");
const publicProfile = read("app/profile/[nickname]/page.tsx");
const title = read("components/Common/ThemeTitle.tsx");
const svg = read("public/images/banners/pink-arena-banner.svg");

assert.equal(themeById("not-a-theme").id, "STANDARD", "unknown theme falls back safely");
assert.equal(themeById("STANDARD").accent, "#ff2f91", "default perimeter accent is pink");
for (const theme of THEMES) assert.ok(theme.accent.startsWith("#"), `theme ${theme.id} has an accent`);

assert.match(banner, /themeById\(/, "banner resolves accent through central theme palette");
assert.match(banner, /--dp-banner-trail/, "banner passes its theme accent to CSS");
assert.match(css, /@keyframes dp-banner-perimeter/, "banner perimeter has a CSS animation");
assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/, "reduced-motion media query is present");
assert.match(css, /@keyframes dp-rating-perimeter/, "rating perimeter animates");
assert.match(css, /\.dp-rating-banner::before/, "rating perimeter is drawn only for equipped banners");
assert.match(rating, /x\.equippedBanner \? "dp-rating-banner" : ""/, "only rows with a server-confirmed equipped banner are highlighted");
assert.match(rating, /themeById\(x\.themePreference\|\|"STANDARD"\)/, "rating accent uses the row owner's theme");
assert.match(rating, /duelplay:theme-changed/, "rating responds to theme changes without reload");
assert.match(rating, /duelplay:banner-changed/, "rating responds to equip/remove events without reload");
assert.match(leaderboard, /themePreference: true/, "leaderboard returns each owner's theme");
assert.match(leaderboard, /equippedBanner: u\.equippedBannerItem\?\.type === "BANNER"/, "leaderboard derives banner state from the equipped database relation");
assert.match(ownProfile, /themeId=\{themePreference\}/, "own profile uses reactive theme context");
assert.match(publicProfile, /themeId=\{p\.themePreference\}/, "public profile uses profile owner's theme");
assert.match(title, /themeById\(/, "title color comes from centralized theme palette");
assert.doesNotMatch(svg, /PINK ARENA|COSMETIC BANNER|ENTER THE ARENA|<circle|<path d="M0 280/, "banner SVG stays minimal");
assert.match(themeProvider, /response\.ok/, "theme selection persistence is checked");
assert.match(themeProvider, /apply\(previousPreference,previousTheme\)/, "failed theme save rolls back optimistic UI");

console.log("DuelPlay profile theme/banner/rating checks: PASS (", 30, "assertions )");
