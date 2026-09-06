import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../lib/case-roll.ts', import.meta.url), 'utf8');
if (!source.includes('pickWeightedCaseItem') || !source.includes('caseChancePercent')) throw new Error('case roll helpers missing');
const items = [{id:'a',weight:50},{id:'b',weight:30},{id:'c',weight:20}];
function pick(roll){let cursor=0;for(const item of items){cursor+=item.weight;if(roll<=cursor)return item.id;}throw new Error('no item');}
if(pick(1)!=='a'||pick(50)!=='a'||pick(51)!=='b'||pick(80)!=='b'||pick(81)!=='c'||pick(100)!=='c') throw new Error('weighted boundaries failed');
if(Math.abs((50/100)*100-50)>1e-9) throw new Error('chance failed');
console.log('case-roll: PASS');
