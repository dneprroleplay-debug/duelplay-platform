import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/auth";
const prisma = new PrismaClient();
async function main() {
  const game = await prisma.game.upsert({ where: { slug: "cs2" }, update: { isEnabled: true }, create: { slug: "cs2", title: "Counter-Strike 2", isEnabled: true, config: {} } });
  const test = await prisma.user.upsert({ where: { nickname: "TestPlayer" }, update: { email: "test@duelplay.local", passwordHash: hashPassword("Test12345!"), status: "ACTIVE" }, create: { steamId: "TEST_STEAM_ID", nickname: "TestPlayer", email: "test@duelplay.local", passwordHash: hashPassword("Test12345!"), referralCode: "TEST001" } });
  await prisma.wallet.upsert({ where: { userId: test.id }, update: {}, create: { userId: test.id, balance: 100 } });
  const rival = await prisma.user.upsert({ where: { nickname: "RivalPlayer" }, update: { email: "rival@duelplay.local", passwordHash: hashPassword("TestRival12345!"), status: "ACTIVE" }, create: { steamId: "RIVAL_STEAM_ID", nickname: "RivalPlayer", email: "rival@duelplay.local", passwordHash: hashPassword("TestRival12345!"), referralCode: "RIVAL002" } });
  await prisma.wallet.upsert({ where: { userId: rival.id }, update: {}, create: { userId: rival.id, balance: 100 } });
  const adminEmail = process.env.DUELPLAY_ADMIN_EMAIL;
  const adminPassword = process.env.DUELPLAY_ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
    const owner=await prisma.user.upsert({ where: { nickname: "DuelPlayOwner" }, update: { email: adminEmail.toLowerCase(), passwordHash: hashPassword(adminPassword), role: "SUPERADMIN", status: "ACTIVE" }, create: { nickname: "DuelPlayOwner", email: adminEmail.toLowerCase(), passwordHash: hashPassword(adminPassword), role: "SUPERADMIN", referralCode: "OWNER001" } });
    await prisma.wallet.upsert({ where: { userId: owner.id }, update: {}, create: { userId: owner.id, balance: 0 } });
  }
  await prisma.siteSettings.upsert({ where: { key: "standardTheme" }, update: {}, create: { key: "standardTheme", value: { id: "STANDARD" }, description: "Standard interface theme" } });
  await prisma.siteSettings.upsert({ where: { key: "standardAccent" }, update: {}, create: { key: "standardAccent", value: { hex: "#ff2f91" }, description: "Standard interface accent" } });
  await prisma.siteSettings.upsert({ where: { key: "backgroundTheme" }, update: {}, create: { key: "backgroundTheme", value: { id: "stars" }, description: "Background atmosphere" } });
  await prisma.siteSettings.upsert({ where: { key: "heroBackground" }, update: {}, create: { key: "heroBackground", value: { id: "hero-01" }, description: "Homepage hero background" } });
  for (const [key,value,minValue,maxValue,step] of [
    ["COMMISSION_RATE",10,0,50,0.5],["REFERRAL_COMMISSION",25,0,50,0.5],["MIN_STAKE",3,0,100000,0.5],["MAX_STAKE",10000,0,100000,0.5],["MIN_DEPOSIT",5,0,100000,0.5],["MIN_WITHDRAWAL",5,0,100000,0.5],["XP_MULTIPLIER",1,0,100,0.5],["REPUTATION_MULTIPLIER",1,0,100,0.5]
  ] as const) await prisma.platformSetting.upsert({where:{key},update:{},create:{key,value,minValue,maxValue,step}});
  for (const key of ["DUELS","CASES","TOURNAMENTS","DUELPASS","PRIME","REFERRALS","PROMOS","STEAM_TRADE","MAINTENANCE_MODE"]) await prisma.featureFlag.upsert({where:{key},update:{},create:{key,enabled:!["TOURNAMENTS","DUELPASS","PRIME","STEAM_TRADE"].includes(key)}});
  for (const u of [test,rival]) await prisma.playerStats.upsert({where:{userId:u.id},update:{},create:{userId:u.id}});
  const rewards=[
    ["First Blood","Win your first duel.",100,{kind:"FIRST_WIN",target:1}],
    ["Unstoppable","Reach a 5 win streak.",250,{kind:"WIN_STREAK",target:5}],
    ["100 Duels","Play 100 duels.",1000,{kind:"TOTAL_DUELS",target:100}],
    ["1000 Kills","Get 1000 kills.",1000,{kind:"TOTAL_KILLS",target:1000}],
    ["Knife Master","Win a knife-only duel.",300,{kind:"KNIFE_WIN",target:1}],
    ["Legend","Reach level 100.",5000,{kind:"LEVEL",target:100}],
  ] as const;
  for(const [name,description,xpReward,conditions] of rewards) await prisma.achievement.upsert({where:{name},update:{description,xpReward,conditions},create:{name,description,xpReward,conditions}});
  for(let day=1;day<=30;day++) await prisma.loginReward.upsert({where:{day},update:{},create:{day,reward:{type:day%7===0?"RARE_CASE":"XP",amount:day%7===0?1:50+day*10}}});
  
  for (const [slug,name,type,price] of [
    ["neon-frame","Neon Frame","FRAME",4.99],["elite-title","ELITE Title","TITLE",7.99],["pink-banner","Pink Arena Banner","BANNER",5.99]
  ] as const) await prisma.cosmeticItem.upsert({where:{slug},update:{name,type,price,active:true},create:{slug,name,type,price,active:true,metadata:{nonPayToWin:true}}});
  const missions=[
    ["daily-3-duels","Play 3 duels","PLAY_DUELS",3,{xp:150}],
    ["daily-2-wins","Win 2 duels","WINS",2,{xp:200}],
    ["daily-case","Open 1 case","OPEN_CASE",1,{xp:100}],
    ["daily-streak","Reach a 3-win streak","STREAK",3,{xp:250}]
  ] as const;
  for(const [slug,name,type,target,reward] of missions) await prisma.mission.upsert({where:{slug},update:{name,description:name,type,target,reward,active:true},create:{slug,name,description:name,type,target,reward,active:true}});
  for(const [slug,name] of [["knife-collection","Knife Collection"],["awp-collection","AWP Collection"],["cyber-collection","Cyber Collection"],["pink-collection","Pink Collection"]] as const) await prisma.collection.upsert({where:{slug},update:{name,active:true},create:{slug,name,requirements:{rarity:"EPIC",count:3},reward:{xp:500},active:true}});
  const activeSeason=await prisma.season.findFirst({where:{active:true},orderBy:{startsAt:"desc"}});
  if(activeSeason){const pass=await prisma.duelPass.findFirst({where:{seasonId:activeSeason.id}});if(!pass)await prisma.duelPass.create({data:{seasonId:activeSeason.id,name:"DuelPass 50",maxLevel:50,startsAt:activeSeason.startsAt,endsAt:activeSeason.endsAt,premiumPrice:19.99,active:true,rewards:Array.from({length:50},(_,i)=>({level:i+1,free:{xp:100+i*10},premium:{case:i%5===0,cosmetic:i%3===0}}))}});}
  const halloweenCase = await prisma.duelCase.upsert({
    where:{slug:"halloween-case"},
    update:{name:"Halloween Case",description:"Limited Halloween event case",price:9.99,imageUrl:"/case-items/halloween.svg",active:true},
    create:{slug:"halloween-case",name:"Halloween Case",description:"Limited Halloween event case",price:9.99,imageUrl:"/case-items/halloween.svg",active:true}
  });
  const halloweenItems=[
    ["Pumpkin Pistol","/case-items/rare.svg","RARE",5.00,70],
    ["Ghost AWP","/case-items/epic.svg","EPIC",12.00,20],
    ["Witch Knife","/case-items/legendary.svg","LEGENDARY",30.00,8],
    ["Halloween Dragon","/case-items/mythic.svg","MYTHIC",70.00,2]
  ] as const;
  for(const [name,imageUrl,rarity,value,weight] of halloweenItems){
    const existing=await prisma.duelCaseItem.findFirst({where:{caseId:halloweenCase.id,name}});
    if(existing) await prisma.duelCaseItem.update({where:{id:existing.id},data:{imageUrl,rarity,value,weight}});
    else await prisma.duelCaseItem.create({data:{caseId:halloweenCase.id,name,imageUrl,rarity,value,weight}});
  }
  const holidayTemplates=[
    ["new-year","New Year","🎄","WINTER",1,1,3,{particles:true,tree:true,gift:true},[{id:"new-year-wins",name:"Win 5 duels",type:"WINS",target:5,reward:{xp:250}}],[{level:1,free:{xp:100}},{level:5,free:{xp:250}}],true,true,1.2,null],
    ["valentines","Valentine's Day","❤️","VALENTINE",2,14,1,{hearts:true},[{id:"valentines-wins",name:"Win 3 duels",type:"WINS",target:3,reward:{xp:150}}],[{level:1,free:{xp:100}}],true,false,1.1,null],
    ["easter","Easter","🐣","SPRING",4,5,3,{flowers:true},[{id:"easter-wins",name:"Win 5 duels",type:"WINS",target:5,reward:{xp:250}}],[{level:1,free:{xp:100}}],true,true,1.1,null],
    ["halloween","Halloween","🎃","HALLOWEEN",10,31,3,{pumpkin:true,ghost:true,particles:true},[{id:"halloween-wins",name:"Win 5 duels",type:"WINS",target:5,reward:{xp:250}},{id:"halloween-matches",name:"Play 10 duels",type:"PLAY_DUELS",target:10,reward:{xp:200}},{id:"halloween-cases",name:"Open 3 cases",type:"OPEN_CASE",target:3,reward:{xp:150}},{id:"halloween-streak",name:"Reach a 3-win streak",type:"STREAK",target:3,reward:{xp:300}}],[{level:1,free:{xp:100}},{level:5,free:{xp:250},premium:{caseSlug:"halloween-case"}},{level:10,free:{xp:500},premium:{cosmetic:true}},{level:15,free:{caseSlug:"halloween-case"},premium:{xp:1000}},{level:20,free:{xp:750},premium:{caseSlug:"halloween-case",cosmetic:true}}],true,true,1.5,halloweenCase.id],
    ["christmas","Christmas","🎁","WINTER",12,25,7,{particles:true,snowman:true,tree:true,gift:true},[{id:"christmas-wins",name:"Win 5 duels",type:"WINS",target:5,reward:{xp:250}}],[{level:1,free:{xp:100}}],true,true,1.25,null]
  ] as const;
  for(const [slug,name,icon,theme,month,day,durationDays,effects,missions,rewards,eventPass,premiumPass,promoMultiplier,caseId] of holidayTemplates){
    await prisma.holidayTemplate.upsert({where:{slug},update:{name,icon,theme,month,day,durationDays,effects,missions,rewards,eventPass,premiumPass,promoMultiplier,caseId,active:true},create:{slug,name,icon,theme,month,day,durationDays,effects,missions,rewards,eventPass,premiumPass,promoMultiplier,caseId,active:true}});
  }
  await prisma.season.updateMany({where:{endsAt:{lt:new Date()},active:true},data:{active:false}});
  const existingSeason=await prisma.season.findFirst({where:{name:"DuelPlay 2026 Season"}});
  if(!existingSeason) await prisma.season.create({data:{name:"DuelPlay 2026 Season",theme:"CYBER",startsAt:new Date(),endsAt:new Date(Date.now()+90*86400000),mode:"AUTO",active:true,effects:{particles:true}}});
  console.log(`Seed complete: ${game.title}; test users ready.`);
}
main().catch(e=>{console.error(e);process.exit(1)}).finally(()=>prisma.$disconnect());
