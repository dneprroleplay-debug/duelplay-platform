import fs from 'node:fs';
const p='components/Common/GlobalUiI18n.tsx';
const s=fs.readFileSync(p,'utf8');
const checks=[
 ['LIVE is protected',s.includes('"LIVE"')],
 ['Take the pot manual RU',s.includes('"Take the pot.": { RU: "Забери банк."')],
 ['Take the pot manual UA',s.includes('UA: "Забери банк."')],
 ['Take the pot manual PL',s.includes('PL: "Zgarnij pulę."')],
 ['Hero slogan manual RU',s.includes('RU: "ЗАШЕЛ.\\nПОБЕДИЛ.\\nЗАБРАЛ."')],
 ['Hero slogan manual UA',s.includes('UA: "ЗАЙШОВ.\\nПЕРЕМІГ.\\nЗАБРАВ."')],
 ['Hero slogan manual PL',s.includes('PL: "WSZEDŁEŚ.\\nWYGRAŁEŚ.\\nODEBRAŁEŚ."')],
 ['Manual translation runs before DeepL',s.indexOf('const manual = manualTranslation(source, lang);') < s.indexOf('if (lang === "EN") {')],
];
let pass=0;
for(const [name,ok] of checks){console.log(`${ok?'PASS':'FAIL'} ${name}`); if(ok)pass++;}
console.log(`${pass}/${checks.length} PASS`);
if(pass!==checks.length)process.exit(1);
