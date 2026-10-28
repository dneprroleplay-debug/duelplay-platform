import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const banner = read('components/Common/ProfileBanner.tsx');
const css = read('app/globals.css');
const matches = read('app/matches/page.tsx');
const live = read('components/Live/Live.tsx');
const i18n = read('lib/ui-i18n.ts');
const png = path.join(process.cwd(), 'public/images/banners/duelplay-neon-logo.png');
assert.ok(fs.existsSync(png), 'transparent supplied logo is included');
assert.match(banner, /src="\/images\/banners\/duelplay-neon-logo\.png"/, 'profile banner renders supplied logo');
assert.match(banner, /dp-profile-banner__trail/, 'animated perimeter remains present');
assert.doesNotMatch(banner, /dp-profile-banner__pink-base|<text[^>]*>DUELPLAY/, 'no opaque base or duplicate logo text');
assert.match(css, /\.dp-profile-banner\{[^}]*background:transparent/s, 'banner container stays transparent');
assert.match(css, /prefers-reduced-motion:reduce/, 'reduced motion support remains');
assert.match(matches, /translateUi\(language, "Create DEMO"\)/, 'top DEMO create button uses shared localization');
assert.match(live, /translateUi\(language, "Create DEMO"\)/, 'main DEMO create link uses shared localization');
assert.match(i18n, /"Create DEMO": \{RU:"Создать DEMO",UA:"Створити DEMO",EN:"Create DEMO",PL:"Utwórz DEMO"\}/, 'all four required labels are centralized');
for (const old of ['Создать DEMO-практику', 'Створити DEMO-практику', 'Utwórz mecz DEMO', 'Create DEMO practice match']) {
  assert.ok(!matches.includes(old), `top button no longer contains old label: ${old}`);
  assert.ok(!live.includes(old), `main link no longer contains old label: ${old}`);
}
console.log('Hub banner and DEMO labels: PASS (10 assertions)');
