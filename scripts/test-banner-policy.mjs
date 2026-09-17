const placements = new Set(['HOME','HOME_HERO','HOME_MID','HOME_BOTTOM']);
const validUrl = (raw) => { raw=String(raw??'').trim(); if(!raw||raw.length>2048)return false; if(raw.startsWith('/'))return true; try{const u=new URL(raw);return u.protocol==='https:'||u.protocol==='http:'}catch{return false}};
const validDates=(a,b)=>{if(a==null||b==null)return true;return new Date(b)>new Date(a)};
const cases=[
 ['home placement',placements.has('HOME')],
 ['invalid placement rejected',!placements.has('BAD')],
 ['relative image',validUrl('/banners/a.webp')],
 ['https image',validUrl('https://cdn.example.com/a.webp')],
 ['javascript rejected',!validUrl('javascript:alert(1)')],
 ['valid dates',validDates('2026-09-01','2026-09-02')],
 ['reversed dates rejected',!validDates('2026-09-02','2026-09-01')],
];
for(const [name,ok] of cases)if(!ok)throw new Error(name);
console.log(`banner-policy: ${cases.length}/${cases.length} PASS`);
