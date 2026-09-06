import { calculateCaseEconomy, assertCaseEconomy } from '../lib/case-economy.ts';
const eq=calculateCaseEconomy(10,[{value:5,weight:65},{value:12,weight:25},{value:28,weight:9},{value:80,weight:1}]);
if(Math.abs(eq.expectedValue-9.57)>1e-9) throw new Error(`unexpected EV ${eq.expectedValue}`);
if(Math.abs(eq.rtp-0.957)>1e-9) throw new Error(`unexpected RTP ${eq.rtp}`);
if(Math.abs(eq.houseEdge-0.043)>1e-9) throw new Error(`unexpected house edge ${eq.houseEdge}`);
assertCaseEconomy(10,[{value:5,weight:65},{value:12,weight:25},{value:28,weight:9},{value:80,weight:1}]);
let failed=false;try{assertCaseEconomy(10,[{value:20,weight:1}])}catch(e){failed=e.message==='CASE_RTP_TOO_HIGH'||e.message==='CASE_HOUSE_EDGE_TOO_LOW'}
if(!failed) throw new Error('RTP ceiling failed');
failed=false;try{assertCaseEconomy(10,[{value:5,weight:10000001}])}catch(e){failed=e.message==='INVALID_CASE_WEIGHT'||e.message==='INVALID_CASE_ITEM_WEIGHT'}
if(!failed) throw new Error('weight limit failed');
console.log('case-economy: PASS');
