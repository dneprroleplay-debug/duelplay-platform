import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const component = fs.readFileSync(path.join(root, "components/Common/ProfileBanner.tsx"), "utf8");
const css = fs.readFileSync(path.join(root, "app/globals.css"), "utf8");
const logo = fs.readFileSync(path.join(root, "public/images/banners/duelplay-neon-logo-cropped.png"));
const mask = fs.readFileSync(path.join(root, "public/images/banners/duelplay-neon-logo-pink-mask.png"));

assert.match(component, /duelplay-neon-logo-cropped\.png/);
assert.match(component, /duelplay-neon-logo-pink-mask\.png|dp-profile-banner__recolor/);
assert.match(component, /<path[\s\S]*pathLength="1000"/);
assert.match(component, /C 40,200 82,193 126,193 C 82,193 40,174 8,150 Z/, "custom silhouette path must be closed");
assert.doesNotMatch(component, /<rect/);
assert.match(css, /mix-blend-mode:color/);
assert.doesNotMatch(css, /\.dp-profile-banner__image[^}]*filter:/, "the complete logo must not receive a global hue filter");
assert.match(css, /-webkit-mask-image:url\('\/images\/banners\/duelplay-neon-logo-pink-mask\.png'\)/);
assert.match(css, /prefers-reduced-motion:reduce[\s\S]*dp-profile-banner__trail path/);
assert.match(css, /aspect-ratio:1983\/470/);
assert.match(css, /dp-banner-perimeter 6\.8s linear infinite/);
const themes = fs.readFileSync(path.join(root, "lib/themes.ts"), "utf8");
assert.match(themes, /id:"BLACK_BLUE", name:"Black \/ Blue", description:"Холодный киберспорт", accent:"#38bdf8"/);
assert.match(themes, /id:"FULL_GREEN", name:"Full Green", description:"Тактический неон", accent:"#8dff52"/);
assert.match(themes, /id:"CYBER_PURPLE", name:"Cyber Purple", description:"Фиолетовый cyber", accent:"#9b5cff"/);
assert.equal((themes.match(/accent:"#[0-9a-f]{6}"/gi) || []).length, 10);
assert.ok(logo.length > 100_000, "cropped source should retain full-quality artwork");
assert.ok(mask.length > 10_000, "color mask should be present");
console.log("Profile banner theme mask: PASS (transparent cropped logo, alpha mask, logo-shaped trail, 10 theme accents, reduced-motion)");
