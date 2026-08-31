export const THEMES = [
  {id:"STANDARD", name:"Black / Pink", description:"Фирменный стиль DuelPlay", accent:"#ff2f91", accent2:"#8dff52", preview:["#050507","#ff2f91","#8dff52"]},
  {id:"BLACK_BLUE", name:"Black / Blue", description:"Холодный киберспорт", accent:"#38bdf8", accent2:"#7dd3fc", preview:["#05070b","#38bdf8","#7dd3fc"]},
  {id:"FULL_GREEN", name:"Full Green", description:"Тактический неон", accent:"#8dff52", accent2:"#d2ffb8", preview:["#050805","#8dff52","#d2ffb8"]},
  {id:"FULL_PINK", name:"Full Pink", description:"Яркий неоновый DuelPlay", accent:"#ff4da6", accent2:"#ffb1d4", preview:["#090509","#ff4da6","#ffb1d4"]},
  {id:"NEON", name:"Neon", description:"Многоцветный неон", accent:"#a78bfa", accent2:"#22d3ee", preview:["#080711","#a78bfa","#22d3ee"]},
  {id:"CYBER_PURPLE", name:"Cyber Purple", description:"Фиолетовый cyber", accent:"#9b5cff", accent2:"#d2b8ff", preview:["#08050d","#9b5cff","#d2b8ff"]},
  {id:"CRIMSON", name:"Crimson", description:"Красный competitive", accent:"#ff4655", accent2:"#ff9aa3", preview:["#0b0507","#ff4655","#ff9aa3"]},
  {id:"ORANGE", name:"Orange Tactical", description:"Оранжевый tactical", accent:"#ff8a3d", accent2:"#ffd0ad", preview:["#0b0704","#ff8a3d","#ffd0ad"]},
  {id:"CYAN", name:"Ice Cyan", description:"Холодный ледяной", accent:"#2dd4bf", accent2:"#9ff7ed", preview:["#040a0b","#2dd4bf","#9ff7ed"]},
  {id:"GOLD", name:"Black / Gold", description:"Премиальный", accent:"#f5c451", accent2:"#ffe7a1", preview:["#090805","#f5c451","#ffe7a1"]},
] as const;
export type ThemeId = typeof THEMES[number]["id"];
export const themeById=(id:string)=>THEMES.find(t=>t.id===id)||THEMES[0];
