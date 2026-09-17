import fs from 'node:fs';
const g=fs.readFileSync('components/Common/GlobalUiI18n.tsx','utf8');
const api=fs.readFileSync('app/api/translate/route.ts','utf8');
const p=fs.readFileSync('app/profile/page.tsx','utf8');
const l=fs.readFileSync('app/leagues/page.tsx','utf8');
const s=fs.readFileSync('app/social/page.tsx','utf8');
const lv=fs.readFileSync('components/Live/Live.tsx','utf8');
const av=fs.readFileSync('components/Profile/AvatarPicker.tsx','utf8');
const u=fs.readFileSync('lib/ui-i18n.ts','utf8');
const checks=[
 ['select options are translatable',!/OPTION/.test(g.match(/const SKIP_TAGS[^;]+;/)?.[0]||'')],
 ['current locale values are protected',g.includes('localizedValues.has(source.trim())')],
 ['text node source tracking is stable',g.includes('type ProcessedText')&&g.includes('previous.translated')],
 ['observer reruns after mutations during translation',g.includes('rerunAfterCurrent.current = true')],
 ['Lv protected',g.includes('"Lv"')&&g.includes('"Lv."')],
 ['1v1 variants protected',g.includes('"1х1"')&&g.includes('"1x1"')&&g.includes('"1v1"')],
 ['maps protected',g.includes('"Mirage"')&&g.includes('"Inferno"')&&g.includes('"Anubis"')],
 ['profile stats are translatable',!p.includes('<div data-no-i18n className="mt-5 space-y-3">')],
 ['league nickname protected',l.includes('data-player-name')],
 ['social chat uses locale key',s.includes('{t.loadChat}')],
 ['chat has explicit translation',u.includes('"Chat": {RU:"Чат"')],
 ['nickname alt text protected',lv.includes('<img data-player-name')&&av.includes('<img data-player-name')],
 ['API accepts full page batch',api.includes('const MAX_ITEMS = 250')],
 ['API chunks to DeepL limit',api.includes('DEEPL_BATCH_SIZE = 50')],
];
let ok=0; for(const [n,v] of checks){console.log(`${v?'PASS':'FAIL'} ${n}`); if(v)ok++;}
if(ok!==checks.length) process.exit(1);
console.log(`Global i18n v5 regression: ${ok}/${checks.length} PASS`);
