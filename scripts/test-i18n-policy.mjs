import fs from 'node:fs'; import path from 'node:path';
const root=process.cwd();
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const keys={};
for(const lang of ['ru','ua','en','pl']){
 const s=read(`locales/${lang}.ts`); keys[lang]=[...s.matchAll(/(?:^|,)([A-Za-z_$][\w$]*)\s*:/g)].map(m=>m[1]);
}
const base=new Set(keys.ru); let pass=true;
for(const l of ['ua','en','pl']){const missing=[...base].filter(k=>!new Set(keys[l]).has(k)); if(missing.length){console.error(l,'missing',missing);pass=false}}
const dirs=['app','components']; const bad=[];
function walk(d){for(const n of fs.readdirSync(d)){if(['node_modules','.next'].includes(n))continue;const p=path.join(d,n),st=fs.statSync(p);if(st.isDirectory())walk(p);else if(/\.(tsx|ts)$/.test(p)){const s=fs.readFileSync(p,'utf8'); if(/language==='(RU|UA)'|language==="(RU|UA)"|ru\?[^\n]*ua\?/.test(s)) bad.push(p)}}}
for(const d of dirs)walk(path.join(root,d));
console.log('locale top-level key parity:',pass?'PASS':'FAIL'); console.log('conditional-language files remaining:',bad.length); bad.slice(0,80).forEach(x=>console.log(' -',path.relative(root,x))); process.exit(pass?0:1);
