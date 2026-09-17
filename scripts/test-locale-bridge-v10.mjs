import fs from 'node:fs';
const global=fs.readFileSync('components/Common/GlobalUiI18n.tsx','utf8');
const bridge=fs.readFileSync('lib/locale-i18n.ts','utf8');
const terms=fs.readFileSync('lib/duelplay-terminology.ts','utf8');
const checks=[
 ['Global translator imports canonical locale bridge', global.includes('translateCanonicalUi')],
 ['Canonical locale bridge reads all four locales', bridge.includes('languages.RU')&&bridge.includes('languages.UA')&&bridge.includes('languages.EN')&&bridge.includes('languages.PL')],
 ['Case title is protected by terminology', terms.includes('Cases — open and claim an item')],
 ['Historical bad case title is recoverable', terms.includes('Дела — открыть дело и подать заявку на получение предмета')],
 ['Historical CASE translation is recoverable', terms.includes('"ПРИМЕР": "CASE"')],
 ['Case badge is protected', terms.includes('"CASE": { RU: "КЕЙС"')],
];
let failed=false; for(const [name,ok] of checks){console.log(`${ok?'PASS':'FAIL'} ${name}`); if(!ok) failed=true;} if(failed) process.exit(1);
