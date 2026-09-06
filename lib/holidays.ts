export type HolidayTemplateInput = {
  slug?: unknown; name?: unknown; icon?: unknown; theme?: unknown;
  month?: unknown; day?: unknown; durationDays?: unknown;
  effects?: unknown; missions?: unknown; rewards?: unknown; caseId?: unknown;
  eventPass?: unknown; premiumPass?: unknown; promoMultiplier?: unknown; active?: unknown;
};

export const HOLIDAY_TEMPLATES = [
  {slug:"new-year",name:"New Year",icon:"🎄",theme:"WINTER",month:1,day:1,durationDays:3,effects:{particles:true,tree:true,gift:true},missions:{wins:5,matches:10,cases:3},rewards:{xp:500,case:true},eventPass:true,premiumPass:true,promoMultiplier:1.2},
  {slug:"valentines",name:"Valentine's Day",icon:"❤️",theme:"VALENTINE",month:2,day:14,durationDays:1,effects:{hearts:true},missions:{wins:3,matches:5},rewards:{xp:300,cosmetic:true},eventPass:true,premiumPass:false,promoMultiplier:1.1},
  {slug:"easter",name:"Easter",icon:"🐣",theme:"SPRING",month:4,day:5,durationDays:3,effects:{flowers:true},missions:{wins:5,matches:10,cases:2},rewards:{xp:400,case:true},eventPass:true,premiumPass:true,promoMultiplier:1.1},
  {slug:"halloween",name:"Halloween",icon:"🎃",theme:"HALLOWEEN",month:10,day:31,durationDays:3,effects:{pumpkin:true,ghost:true,particles:true},missions:{wins:5,matches:10,cases:3,streak:3},rewards:{xp:500,cosmetic:true,case:true},eventPass:true,premiumPass:true,promoMultiplier:1.5},
  {slug:"christmas",name:"Christmas",icon:"🎁",theme:"WINTER",month:12,day:25,durationDays:7,effects:{particles:true,snowman:true,tree:true,gift:true},missions:{wins:5,matches:10,cases:3,streak:3},rewards:{xp:750,cosmetic:true,case:true},eventPass:true,premiumPass:true,promoMultiplier:1.25},
] as const;

export function validateHolidayTemplate(input: HolidayTemplateInput) {
  const slug=String(input.slug??"").trim().toLowerCase(); const name=String(input.name??"").trim(); const theme=String(input.theme??"").trim();
  const month=Number(input.month), day=Number(input.day), durationDays=Number(input.durationDays??1), promoMultiplier=Number(input.promoMultiplier??1);
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||slug.length>80) throw new Error("INVALID_SLUG");
  if(!name||name.length>120||!theme||theme.length>80) throw new Error("INVALID_NAME");
  if(!Number.isInteger(month)||month<1||month>12||!Number.isInteger(day)||day<1||day>31) throw new Error("INVALID_DATE");
  const probe=new Date(Date.UTC(2000,month-1,day));
  if(probe.getUTCMonth()!==month-1||probe.getUTCDate()!==day) throw new Error("INVALID_DATE");
  if(!Number.isInteger(durationDays)||durationDays<1||durationDays>31) throw new Error("INVALID_DURATION");
  if(!Number.isFinite(promoMultiplier)||promoMultiplier<1||promoMultiplier>100) throw new Error("INVALID_MULTIPLIER");
  const eventPass=input.eventPass===true, premiumPass=input.premiumPass===true;
  if(premiumPass&&!eventPass) throw new Error("PREMIUM_REQUIRES_PASS");
  return {slug,name,theme,month,day,durationDays,promoMultiplier,eventPass,premiumPass,icon:input.icon?String(input.icon).slice(0,16):null,active:input.active!==false,effects:input.effects??null,missions:input.missions??null,rewards:input.rewards??null,caseId:input.caseId?String(input.caseId):null};
}

export function holidayWindow(year:number, month:number, day:number, durationDays:number) {
  const startsAt=new Date(Date.UTC(year,month-1,day,0,0,0));
  const endsAt=new Date(startsAt.getTime()+durationDays*86400000);
  return {startsAt,endsAt};
}

export function holidayIsActive(month:number,day:number,durationDays:number,now=new Date()) {
  const {startsAt,endsAt}=holidayWindow(now.getUTCFullYear(),month,day,durationDays);
  return now>=startsAt&&now<endsAt;
}
