import { normalizeCaseRarity, rarityChancePercent } from "../lib/case-rarity.ts";
const assert=(v,m)=>{if(!v)throw new Error(m)};
assert(normalizeCaseRarity("rare")==="Rare","rare normalization");
assert(normalizeCaseRarity(" MYTHIC ")==="Mythic","mythic normalization");
let threw=false;try{normalizeCaseRarity("legend") }catch(e){threw=e.message==="INVALID_RARITY"};assert(threw,"invalid rarity rejected");
const items=[{rarity:"Common",weight:50},{rarity:"Rare",weight:25},{rarity:"Rare",weight:25}];
assert(Math.abs(rarityChancePercent("Rare",items)-50)<1e-9,"rarity chance");
console.log("case-rarity: PASS");
