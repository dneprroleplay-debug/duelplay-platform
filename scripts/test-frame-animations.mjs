import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const read = (file) => fs.readFileSync(file, "utf8");
const css = read("app/globals.css");
const inventory = read("app/inventory/page.tsx");
const rewards = read("app/login-rewards/page.tsx");
const profile = read("app/profile/page.tsx");
const publicProfile = read("app/profile/[nickname]/page.tsx");
const frameSlugs = [
  "frame-neon-pulse", "frame-electric-storm", "frame-inferno-crown",
  "frame-level-10", "frame-level-20", "frame-level-30", "frame-level-40",
  "frame-level-50", "frame-level-75", "frame-level-100",
];
for (const slug of frameSlugs) {
  assert.match(css, new RegExp(`\\.frame-glow--${slug.replaceAll("-", "\\-")}(?:\\{|\\s)`), `Missing animation selector for ${slug}`);
  const svgPath = path.join("public", "images", "frames", `${slug}.svg`);
  assert.ok(fs.existsSync(svgPath), `Missing SVG asset ${svgPath}`);
}
assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/, "Reduced-motion accessibility rule missing");
assert.match(rewards, /frame-glow frame-glow--\$\{slug\}/, "Login reward frame preview is not animated");
assert.match(inventory, /frame-glow frame-glow--\$\{frame\.slug\}/, "Inventory frame preview is not animated");
assert.match(profile, /frame-glow frame-glow--\$\{data\.equippedFrame\.slug\}/, "Own profile equipped frame is not animated");
assert.match(publicProfile, /frame-glow frame-glow--\$\{p\.equippedFrame\.slug\}/, "Public profile equipped frame is not animated");
for (const keyframe of ["dp-frame-neon-pulse", "dp-frame-electric-storm", "dp-frame-inferno-crown", "dp-frame-level-pink", "dp-frame-level-violet", "dp-frame-level-rose-gold", "dp-frame-level-gold", "dp-frame-level-mythic"]) {
  assert.match(css, new RegExp(`@keyframes\\s+${keyframe}\\b`), `Missing keyframes: ${keyframe}`);
}
console.log(`Frame animation checks: PASS (${frameSlugs.length} frame styles, 4 render locations, reduced-motion support)`);
