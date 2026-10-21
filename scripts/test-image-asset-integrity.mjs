/**
 * Image asset integrity audit.
 *
 * Checks every local image shipped in `public/`:
 *  - the real container format is detected from the magic bytes;
 *  - the detected format must match the file extension;
 *  - every local image path referenced from the app source must exist on disk;
 *  - remote image URLs are collected and reported (they are NOT fetched here,
 *    so a remote URL is only reported as "declared", never as "verified").
 *
 * Run: node scripts/test-image-asset-integrity.mjs
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, extname, posix } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const publicDir = join(root, "public");
const sourceDirs = ["app", "components", "lib", "scripts", "public"];

const SIGNATURES = [
  { ext: ".jpg", mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { ext: ".png", mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { ext: ".gif", mime: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38] },
];

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".avif"]);

function detectFormat(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { ext: ".jpg", mime: "image/jpeg" };
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: ".png", mime: "image/png" };
  if (buffer.length >= 6 && buffer.subarray(0, 3).toString("ascii") === "GIF") return { ext: ".gif", mime: "image/gif" };
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return { ext: ".webp", mime: "image/webp" };
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("ascii").toLowerCase();
    if (brand.startsWith("avif") || brand.startsWith("avis")) return { ext: ".avif", mime: "image/avif" };
  }
  const head = buffer.subarray(0, 512).toString("utf8").trim();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return { ext: ".svg", mime: "image/svg+xml" };
  return null;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const localFiles = walk(publicDir).filter(file => IMAGE_EXTENSIONS.has(extname(file).toLowerCase()));
const mismatches = [];
const unknown = [];

for (const file of localFiles) {
  const buffer = readFileSync(file);
  const detected = detectFormat(buffer);
  const ext = extname(file).toLowerCase();
  const rel = relative(root, file).split("\\").join("/");
  if (!detected) {
    unknown.push(rel);
    continue;
  }
  const normalizedExt = ext === ".jpeg" ? ".jpg" : ext;
  if (detected.ext === ".svg" && normalizedExt !== ".svg") {
    mismatches.push({ file: rel, expected: ".svg", actual: normalizedExt });
    continue;
  }
  if (detected.ext !== normalizedExt) mismatches.push({ file: rel, expected: detected.ext, actual: normalizedExt });
}

// Collect local asset references from the application source.
const sourceFiles = sourceDirs
  .flatMap(dir => (existsSync(join(root, dir)) ? walk(join(root, dir)) : []))
  .filter(file => /\.(ts|tsx|mjs|cjs|js|css|json|md)$/.test(file) && !file.includes(`${posix.sep}node_modules${posix.sep}`));

const referenced = new Map();
const remoteUrls = new Set();
for (const file of sourceFiles) {
  const text = readFileSync(file, "utf8");
  const rel = relative(root, file).split("\\").join("/");
  const localPattern = /["'`](\/(?:images|hero-backgrounds|season-heroes|branding|payment-methods|avatars|cases|case-items|flags|icons|backgrounds)\/[A-Za-z0-9._\-/]+)["'`]/g;
  let match;
  while ((match = localPattern.exec(text))) {
    const target = match[1];
    if (!referenced.has(target)) referenced.set(target, new Set());
    referenced.get(target).add(rel);
  }
  const remotePattern = /https?:\/\/[A-Za-z0-9._\-/]+\.(?:png|jpe?g|webp|gif|svg|avif)(?:\?[A-Za-z0-9._\-=&%]*)?/gi;
  let remote;
  while ((remote = remotePattern.exec(text))) remoteUrls.add(remote[0]);
}

const missing = [];
for (const [target, sources] of referenced) {
  const absolute = join(publicDir, target.replace(/^\//, ""));
  if (!existsSync(absolute)) missing.push({ target, sources: [...sources] });
}

let failures = 0;
function report(ok, label, detail) {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
}

for (const entry of mismatches) {
  report(false, `format matches extension: ${entry.file}`, `content is ${entry.expected}, extension says ${entry.actual}`);
}
for (const entry of missing) {
  report(false, `referenced asset exists: ${entry.target}`, `referenced by ${entry.sources.join(", ")}`);
}
for (const entry of unknown) {
  report(false, `format detected: ${entry}`, "unknown container");
}
if (!mismatches.length) console.log(`PASS format matches extension for all ${localFiles.length} local images`);
if (!missing.length) console.log(`PASS all ${referenced.size} referenced local image paths exist`);
if (!unknown.length) console.log("PASS no undecodable image files");

console.log(`INFO remote image URLs declared in source: ${remoteUrls.size} (declared only, not fetched/visually verified)`);
for (const url of [...remoteUrls].slice(0, 40)) console.log(`INFO remote ${url}`);

console.log(`Summary: ${failures} FAIL`);
process.exit(failures ? 1 : 0);
