import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');
const global = read('components/Common/GlobalUiI18n.tsx');
const home = read('app/page.tsx');
const games = read('components/Games/Games.tsx');
const live = read('components/Live/Live.tsx');
const publicProfile = read('app/profile/[nickname]/page.tsx');

const checks = [
  ['OPTION elements are translatable', !/SKIP_TAGS\s*=.*OPTION/.test(global)],
  ['Header is not globally skipped', !/element\.closest\("header"\)/.test(global)],
  ['Russian uses DeepL fallback', !/if\s*\(lang\s*===\s*["']RU["']\)\s*continue/.test(global)],
  ['Translation cache was bumped', global.includes('duelplay-i18n-cache-v10')],
  ['English is the canonical component dictionary', read('components/Common/LanguageContext.tsx').includes('t: languages.EN')],
  ['Server translation memory is wired', read('lib/deepl.ts').includes('translationCache.findMany') && read('lib/deepl.ts').includes('translationCache.createMany')],
  ['1x1 format is protected', global.includes('^\\d+\\s*[×xхХvV]\\s*\\d+$') || global.includes('^\\d+\\s*[×xхХvV]')],
  ['XP multipliers are protected', global.includes('^\\d+\\s*[×xхХvV]\\s*XP$')],
  ['CS2 is protected', global.includes('"CS2"')],
  ['Maps are protected centrally', ['Mirage','Dust2','Ancient','Train','Overpass','Inferno','Nuke','Anubis'].every((m) => global.includes(`"${m}"`))],
  ['Homepage format is real 1x1', home.includes('value="1х1"') && !home.includes('value="1С…1"')],
  ['Homepage map cards protect map names', games.includes('data-no-i18n className="mt-1 text-2xl font-black"')],
  ['Live map filters protect map names', live.includes('<span data-no-i18n>{m}</span>')],
  ['Public profile map options protect map names', publicProfile.includes('<option data-no-i18n key={x}>{x}</option>')],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failed++;
}
process.exitCode = failed ? 1 : 0;
