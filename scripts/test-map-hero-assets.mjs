/**
 * Regression test for the map-image and hero-background asset layout.
 *
 * - every duel map of the catalogue owns exactly one image file named after
 *   the map id;
 * - the maps image folder contains no leftovers, no duplicate map images and
 *   every file's real format matches its extension;
 * - the hero catalogue exposes exactly ten slots: hero-01 stays the original
 *   JPEG, hero-02..hero-10 are the nine new PNG backgrounds;
 * - the admin picker keeps working through the shared hero catalogue.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = process.cwd();
const publicDir = path.join(root, "public");
const mapsDir = path.join(publicDir, "images/maps");
const heroesDir = path.join(publicDir, "hero-backgrounds");

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function detectFormat(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  const head = buffer.subarray(0, 400).toString("utf8").trim();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "svg";
  return "unknown";
}

let passed = 0;
let failed = 0;
const check = (ok, label) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  ok ? passed++ : failed++;
};

// ---------------------------------------------------------------- maps
const catalogue = fs.readFileSync(path.join(root, "lib/duel-maps.ts"), "utf8");
const entries = [...catalogue.matchAll(/id: "([a-z0-9_]+)"[\s\S]{0,220}?image: "([^"]+)"/g)];
check(entries.length === 10, `duel map catalogue exposes 10 maps (found ${entries.length})`);

const expectedMapFiles = new Set();
for (const [, id, image] of entries) {
  const file = path.join(publicDir, image.replace(/^\//, ""));
  check(fs.existsSync(file), `map image exists: ${image}`);
  if (fs.existsSync(file)) {
    const buffer = fs.readFileSync(file);
    const real = detectFormat(buffer);
    check(real === path.extname(file).slice(1).toLowerCase(), `map image format matches extension: ${path.basename(file)} (${real})`);
    check(path.basename(file) === `${id}.png`, `map image is named after the map id: ${id} -> ${path.basename(file)}`);
    expectedMapFiles.add(path.basename(file));
  }
}

// classic CS2 thumbnails are still used by the match page fallback
for (const classic of ["ancient.jpg", "dust2.jpg", "inferno.jpg", "mirage.jpg", "nuke.jpg", "overpass.webp", "train.webp", "anubis.webp"]) {
  const file = path.join(mapsDir, classic);
  check(fs.existsSync(file), `classic map thumbnail kept: ${classic}`);
  if (fs.existsSync(file)) expectedMapFiles.add(classic);
}
// the small placeholder that the profile and live views use
const placeholder = path.join(mapsDir, "aim_redline.svg");
check(fs.existsSync(placeholder), "referenced map placeholder kept: aim_redline.svg");
if (fs.existsSync(placeholder)) expectedMapFiles.add("aim_redline.svg");

const actualMapFiles = fs.readdirSync(mapsDir).filter((name) => fs.statSync(path.join(mapsDir, name)).isFile());
const leftovers = actualMapFiles.filter((name) => !expectedMapFiles.has(name));
check(leftovers.length === 0, `no leftover files in the maps image folder${leftovers.length ? `: ${leftovers.join(", ")}` : ""}`);
check(actualMapFiles.length === expectedMapFiles.size, `maps image folder holds exactly ${expectedMapFiles.size} files (found ${actualMapFiles.length})`);

// no source may reference a removed asset
const removedNames = ["pool_day_classic.png", "one_v_one_remastered.png", "one_v_one_arena.png", "one_v_one_oasis.png", "one_v_one_v3.png", "aim_dust2_photo.png", "1v1_aim_map.svg", "1v1_anubis_aim.svg", "1v1_arena.svg", "1v1_oasis.svg", "1v1_remastered.svg", "1v1_v3.svg", "aim_halloween_1v1.svg"];
const sources = ["app", "components", "lib", "scripts", "locales"];
const staleRefs = [];
const walk = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git", "bin", "obj"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (!/\.(ts|tsx|mjs|js|css|json|md)$/.test(entry.name)) continue;
    const text = fs.readFileSync(full, "utf8");
    for (const name of removedNames) {
      if (text.includes(`/images/maps/${name}`) || text.includes(`maps/${name}`)) staleRefs.push(`${path.relative(root, full)} -> ${name}`);
    }
  }
};
for (const dir of sources) walk(path.join(root, dir));
check(staleRefs.length === 0, `no source references a removed map asset${staleRefs.length ? `: ${staleRefs.join(", ")}` : ""}`);

// ---------------------------------------------------------------- heroes
const heroCatalogue = fs.readFileSync(path.join(root, "lib/hero-backgrounds.ts"), "utf8");
const heroSlots = [...heroCatalogue.matchAll(/"(hero-\d\d)": "([^"]+)"/g)];
check(heroSlots.length === 10, `hero catalogue exposes 10 slots (found ${heroSlots.length})`);

const heroHashes = new Map();
for (const [, id, image] of heroSlots) {
  const file = path.join(publicDir, image.replace(/^\//, ""));
  check(fs.existsSync(file), `hero image exists: ${image}`);
  if (!fs.existsSync(file)) continue;
  const buffer = fs.readFileSync(file);
  const real = detectFormat(buffer);
  check(real === path.extname(file).slice(1).toLowerCase(), `hero format matches extension: ${path.basename(file)} (${real})`);
  heroHashes.set(id, { hash: sha256(file), bytes: buffer.length, real });
}

const hero01 = heroHashes.get("hero-01");
check(Boolean(hero01) && hero01.real === "jpg", "hero-01 is still the original JPEG");
check(
  hero01 && hero01.hash === "12e4ba934d8f6f1a8e3bac946f42d7b176420d3a98c828f72f7ac3db2428c7ae",
  "hero-01 bytes are unchanged (pinned SHA-256)",
);

const newHeroes = ["hero-02", "hero-03", "hero-04", "hero-05", "hero-06", "hero-07", "hero-08", "hero-09", "hero-10"];
for (const id of newHeroes) {
  const entry = heroHashes.get(id);
  check(Boolean(entry) && entry.real === "png", `${id} is a PNG`);
}
const hashes = newHeroes.map((id) => heroHashes.get(id)?.hash);
check(new Set(hashes).size === 9, "the nine new hero backgrounds are all different images");

const heroFiles = fs.readdirSync(heroesDir).filter((name) => fs.statSync(path.join(heroesDir, name)).isFile());
const expectedHeroFiles = new Set(heroSlots.map(([, , image]) => path.basename(image)));
const heroLeftovers = heroFiles.filter((name) => !expectedHeroFiles.has(name));
check(heroLeftovers.length === 0, `no leftover files in the hero folder${heroLeftovers.length ? `: ${heroLeftovers.join(", ")}` : ""}`);
check(heroFiles.length === 10, `hero folder holds exactly 10 files (found ${heroFiles.length})`);

// the admin picker must use the shared catalogue so the switcher keeps working
const adminPanel = fs.readFileSync(path.join(root, "components/Admin/LegacyAdminPanel.tsx"), "utf8");
check(adminPanel.includes("heroBackgroundOptions()"), "the admin hero picker uses the shared hero catalogue");
check(adminPanel.includes('action:"heroBackground"'), "the admin can still save the selected hero background");
const adminApi = fs.readFileSync(path.join(root, "app/api/admin/route.ts"), "utf8");
check(adminApi.includes('action==="heroBackground"'), "the admin API still accepts the heroBackground action");

console.log(`\nSummary: ${passed} PASS, ${failed} FAIL`);
process.exitCode = failed ? 1 : 0;
