import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { validatePlatformSettingValue, validatePlatformSettingRelationships, PLATFORM_SETTING_RULES } from "@/lib/platform-setting-policy";
import { grantDepositBonus } from "@/lib/promotions";
import { requireAdmin, adminLevel, audit } from "@/lib/admin";
import { THEMES, themeById } from "@/lib/themes";
import { awardXp, updateMatchProgress, updateRatingAfterDuel } from "@/lib/progression";
import { creditWallet, debitWallet } from "@/lib/wallet";
import { validateFeatureFlagPayload } from "@/lib/feature-flags";

const OWNER_STEAM_ID = process.env.DUELPLAY_OWNER_STEAM_ID?.trim();
function protectedOwner(u:{steamId:string|null;nickname:string;role:string}){
  return Boolean(OWNER_STEAM_ID&&u.steamId===OWNER_STEAM_ID) || u.nickname==="DuelPlayOwner";
}


async function hydrateTicketSenders<T extends {messages?: Array<{senderId:string}>}>(ticket: T){
 const ids=[...new Set((ticket.messages||[]).map(m=>m.senderId))];
 if(!ids.length)return ticket;
 const users=await prisma.user.findMany({where:{id:{in:ids}},select:{id:true,nickname:true,role:true}});
 const byId=new Map(users.map(u=>[u.id,u]));
 return {...ticket,messages:(ticket.messages||[]).map(m=>({...m,sender:byId.get(m.senderId)||null}))} as T & {messages:Array<any>};
}

async function hydrateTickets<T extends {messages?: Array<{senderId:string}>}>(tickets:T[]){
 const ids=[...new Set(tickets.flatMap(t=>(t.messages||[]).map(m=>m.senderId)))];
 if(!ids.length)return tickets;
 const users=await prisma.user.findMany({where:{id:{in:ids}},select:{id:true,nickname:true,role:true}});
 const byId=new Map(users.map(u=>[u.id,u]));
 return tickets.map(t=>({...t,messages:(t.messages||[]).map(m=>({...m,sender:byId.get(m.senderId)||null}))})) as any;
}

export async function GET(){
  try{
    const me=await requireAdmin(1);
    const [users,matches,transactions,disputes,fraud,tickets,settings,topSkins,servers,logs,avatarPresets,platformSettings,featureFlags,creatorPayouts,withdrawals,deposits,onlineSessions]=await Promise.all([
      prisma.user.findMany({orderBy:{createdAt:"desc"},take:100,select:{id:true,nickname:true,email:true,role:true,status:true,createdAt:true,steamId:true,wallet:{select:{balance:true,lockedBalance:true}}}}),
      prisma.match.findMany({orderBy:{createdAt:"desc"},take:100,include:{playerOne:{select:{nickname:true}},playerTwo:{select:{nickname:true}},game:{select:{title:true}}}}),
      prisma.transaction.findMany({orderBy:{createdAt:"desc"},take:100,include:{wallet:{include:{user:{select:{nickname:true}}}}}}),
      prisma.dispute.findMany({orderBy:{createdAt:"desc"},take:50,include:{match:true,reporter:{select:{nickname:true}}}}),
      prisma.fraudCase.findMany({orderBy:{createdAt:"desc"},take:50,include:{user:{select:{nickname:true}}}}),
      prisma.supportTicket.findMany({orderBy:{updatedAt:"desc"},take:50,include:{user:{select:{nickname:true}},messages:{orderBy:{createdAt:"asc"}}}}),
      prisma.siteSettings.findMany({where:{key:{in:["standardTheme","backgroundTheme","heroBackground"]}}}),
      prisma.topSkin.findMany({orderBy:[{sortOrder:"asc"},{createdAt:"desc"}],take:40}),
      prisma.gameServer.findMany({orderBy:{createdAt:"asc"},include:{match:{select:{id:true,status:true,mapName:true,playerOne:{select:{nickname:true}},playerTwo:{select:{nickname:true}}}}}}),
      prisma.auditLog.findMany({orderBy:{createdAt:"desc"},take:100,include:{user:{select:{nickname:true}}}}),
      prisma.avatarPreset.findMany({orderBy:[{sortOrder:"asc"},{createdAt:"desc"}],take:60}),
      prisma.platformSetting.findMany({orderBy:{key:"asc"}}),
      prisma.featureFlag.findMany({orderBy:{key:"asc"}}),
      prisma.creatorPayout.findMany({orderBy:{createdAt:"desc"},take:100,include:{user:{select:{nickname:true}}}}),
      prisma.withdrawal.findMany({orderBy:{createdAt:"desc"},take:100,include:{wallet:{include:{user:{select:{nickname:true}}}}}}),
      prisma.deposit.findMany({orderBy:{createdAt:"desc"},take:100,include:{wallet:{include:{user:{select:{nickname:true}}}}}}),
      prisma.userSession.count({where:{isRevoked:false,expiresAt:{gt:new Date()},lastActiveAt:{gte:new Date(Date.now()-5*60*1000)}}})
    ]);
    const row=settings.find(x=>x.key==="standardTheme");
    const standard=typeof row?.value==="object"&&row?.value&&"id" in row.value?String((row.value as {id?:unknown}).id):"STANDARD";
    const level=adminLevel(me.role);
    const userRows=users.map(u=>({...u,balance:Number(u.wallet?.balance??0),lockedBalance:Number(u.wallet?.lockedBalance??0),wallet:undefined}));
    const bgRow=settings.find(x=>x.key==="backgroundTheme");
    const background=typeof bgRow?.value==="object"&&bgRow?.value&&"id" in bgRow.value?String((bgRow.value as {id?:unknown}).id):"stars";
    const heroRow=settings.find(x=>x.key==="heroBackground");
    const heroBackground=typeof heroRow?.value==="object"&&heroRow?.value&&"id" in heroRow.value?String((heroRow.value as {id?:unknown}).id):"hero-01";
    const completedTransactions=transactions.filter(t=>t.status==="COMPLETED");const revenueTypes=["COMMISSION","CASE_OPEN","COSMETIC_PURCHASE","PRIME_PURCHASE","DUELPASS_PURCHASE","EVENTPASS_PURCHASE","XP_BOOSTER_PURCHASE"];const expenseTypes=["REFERRAL","REFERRAL_RACE_PRIZE","TOURNAMENT_PRIZE"];const revenueByType=Object.fromEntries([...new Set([...revenueTypes,...expenseTypes])].map(type=>[type,completedTransactions.filter(t=>t.type===type).reduce((n,t)=>n+Math.max(0,Number(t.amount)),0)]));const revenue=revenueTypes.reduce((n,type)=>n+(revenueByType[type]||0),0);const expenses=expenseTypes.reduce((n,type)=>n+(revenueByType[type]||0),0);const dayAgo=new Date(Date.now()-86400000);const completedMatchVolume=matches.filter(m=>m.createdAt>=dayAgo&&["FINISHED","CANCELLED"].includes(m.status)).reduce((n,m)=>n+Number(m.betAmount)*2,0);const openDisputes=disputes.filter(x=>["OPEN","UNDER_REVIEW","AI_PROCESSED"].includes(x.status)).length;const openFraud=fraud.filter(x=>!["CONFIRMED_BANNED","FALSE_POSITIVE_CLEARED"].includes(x.status)).length;
    const dashboard={users:users.length,online:onlineSessions,matchesToday:matches.filter(m=>m.createdAt>=dayAgo).length,liveMatches:matches.filter(m=>m.status==="LIVE").length,activeServers:servers.filter(s=>s.status==="BUSY"||s.status==="STARTING").length,volume:completedMatchVolume,revenue,deposits:completedTransactions.filter(t=>t.type==="DEPOSIT").reduce((n,t)=>n+Math.max(0,Number(t.amount)),0),withdrawals:completedTransactions.filter(t=>t.type==="WITHDRAW").reduce((n,t)=>n+Math.max(0,Number(t.amount)),0),referralPayouts:revenueByType.REFERRAL||0,creatorPayouts:creatorPayouts.filter(p=>p.status!=="REJECTED").reduce((n,p)=>n+Number(p.amount),0),pendingWithdrawals:withdrawals.filter(x=>x.status!=="COMPLETED"&&x.status!=="REJECTED"&&x.status!=="FAILED").length,pendingDeposits:deposits.filter(x=>x.status!=="COMPLETED"&&x.status!=="FAILED"&&x.status!=="EXPIRED").length,openDisputes,openFraud,revenueByType,expenses,netRevenue:revenue-expenses};
    return NextResponse.json({me:{nickname:me.nickname,role:me.role,level},themes:THEMES,standardTheme:themeById(standard).id,backgroundTheme:background,heroBackground,platformSettings:level>=5?platformSettings:[],featureFlags:level>=5?featureFlags:[],creatorPayouts:level>=3?creatorPayouts:[],withdrawals:level>=3?withdrawals:[],deposits:level>=3?deposits:[],dashboard,users:level>=2?userRows:[],matches:level>=2?matches:[],transactions:level>=3?transactions:[],disputes:level>=2?disputes:[],fraud:level>=2?fraud:[],tickets:level>=2?await hydrateTickets(tickets):[],topSkins:level>=3?topSkins:[],servers:level>=3?servers:[],logs:level>=3?logs:[],avatarPresets:level>=3?avatarPresets:[]});
  }catch(e){
    if(e instanceof Error&&e.message==="FORBIDDEN")return NextResponse.json({error:"Недостаточно прав"},{status:403});
    console.error(e);return NextResponse.json({error:"Не удалось загрузить админку"},{status:500});
  }
}

export async function PATCH(request:NextRequest){
  try{
    const me=await requireAdmin(1);
    const body=await request.json();
    const action=String(body.action||"");

    if(action==="resolveDispute"){
      if(adminLevel(me.role)<2)return NextResponse.json({error:"Недостаточно прав"},{status:403});
      const disputeId=String(body.disputeId||"");
      const decision=String(body.decision||"") as "DRAW"|"WINNER_PLAYER_ONE"|"WINNER_PLAYER_TWO"|"CANCELLED_REFUND";
      if(!disputeId||!["DRAW","WINNER_PLAYER_ONE","WINNER_PLAYER_TWO","CANCELLED_REFUND"].includes(decision)){
        return NextResponse.json({error:"Некорректное решение спора"},{status:400});
      }
      const result=await prisma.$transaction(async tx=>{
        const dispute=await tx.dispute.findUnique({where:{id:disputeId},include:{match:true}});
        if(!dispute)return null;
        if(dispute.status==="RESOLVED_BY_ADMIN"||dispute.status==="CLOSED")return dispute;
        const match=dispute.match;
        if(!match.playerOneId||!match.playerTwoId)throw new Error("INVALID_MATCH_PLAYERS");
        const stake=Number(match.betAmount);
        const p1=match.playerOneId,p2=match.playerTwoId;
        const refundIds=[p1,p2];
        const winnerId=decision==="WINNER_PLAYER_ONE"?p1:decision==="WINNER_PLAYER_TWO"?p2:null;
        const loserId=winnerId?(winnerId===p1?p2:p1):null;
        const now=new Date();

        if(!winnerId){
          for(const userId of refundIds){
            const walletRows=await tx.$queryRaw<Array<{id:string,userId:string,balance:any,lockedBalance:any}>>`SELECT id, "userId", balance, "lockedBalance" FROM "Wallet" WHERE "userId" = ${userId}::uuid FOR UPDATE`;
            const wallet=walletRows[0];
            if(!wallet)throw new Error("WALLET");
            if(Number(wallet.lockedBalance)<stake)throw new Error("LOCKED_STAKE");
            const idem=`dispute-refund:${dispute.id}:${userId}`;
            const credited=await creditWallet(tx,userId,stake,idem,"REFUND","Dispute resolved: refund",match.id);
            if(!credited.idempotent)await tx.wallet.update({where:{id:wallet.id},data:{lockedBalance:{decrement:stake}}});
          }
        }else{
          const walletRows=await tx.$queryRaw<Array<{id:string,userId:string,balance:any,lockedBalance:any}>>`SELECT id, "userId", balance, "lockedBalance" FROM "Wallet" WHERE "userId" IN (${winnerId}::uuid, ${loserId!}::uuid) FOR UPDATE`;
          const winnerWallet=walletRows.find(w=>w.userId===winnerId);
          const loserWallet=walletRows.find(w=>w.userId===loserId!);
          if(!winnerWallet||!loserWallet)throw new Error("WALLET");
          if(Number(winnerWallet.lockedBalance)<stake||Number(loserWallet.lockedBalance)<stake)throw new Error("LOCKED_STAKE");
          const payout=Math.max(0,Number((stake*2-Number(match.commission)).toFixed(4)));
          const idem=`dispute-win:${dispute.id}`;
          const credited=await creditWallet(tx,winnerId,payout,idem,"MATCH_WIN","Dispute resolved: player win",match.id);
          if(!credited.idempotent){
            await tx.wallet.update({where:{id:winnerWallet.id},data:{lockedBalance:{decrement:stake}}});
            await tx.wallet.update({where:{id:loserWallet.id},data:{lockedBalance:{decrement:stake}}});
            await awardXp(tx,winnerId,100);
            await awardXp(tx,loserId!,25);
            await updateMatchProgress(tx,winnerId,true);
            await updateMatchProgress(tx,loserId!,false);
            await updateRatingAfterDuel(tx,winnerId,loserId!);
          }
        }

        const updated=await tx.match.update({
          where:{id:match.id},
          data:{
            status:"FINISHED",
            winnerId: winnerId,
            loserId: loserId,
            endedAt:now,
            connectionPhaseCompleted:true
          }
        });
        const d=await tx.dispute.update({
          where:{id:dispute.id},
          data:{status:"RESOLVED_BY_ADMIN",adminDecision:decision,adminNotes:String(body.notes||"").slice(0,2000),resolvedAt:now}
        });
        await audit(me.id,"RESOLVE_DISPUTE","DISPUTE",dispute.id,{decision,matchId:match.id,winnerId,loserId});
        return {dispute:d,match:updated};
      });
      if(!result)return NextResponse.json({error:"Спор не найден"},{status:404});
      return NextResponse.json({ok:true,...result});
    }

    if(action==="revokeUserSessions"||action==="revokeAllSessions"){
      if(adminLevel(me.role)<5)return NextResponse.json({error:"Только SUPERADMIN"},{status:403});
      const userId=String(body.userId||"");
      if(action==="revokeUserSessions"&&!userId)return NextResponse.json({error:"Не указан пользователь"},{status:400});
      const result=await prisma.$transaction(async tx=>{
        if(action==="revokeAllSessions"){
          const updated=await tx.userSession.updateMany({where:{isRevoked:false},data:{isRevoked:true}});
          return {count:updated.count,scope:"ALL" as const};
        }
        const target=await tx.user.findUnique({where:{id:userId},select:{id:true,nickname:true,steamId:true,role:true}});
        if(!target)return Promise.reject(new Error("USER_NOT_FOUND"));
        if(protectedOwner(target))return Promise.reject(new Error("OWNER_TARGET"));
        const updated=await tx.userSession.updateMany({where:{userId:target.id,isRevoked:false},data:{isRevoked:true}});
        return {count:updated.count,scope:"USER" as const,userId:target.id,nickname:target.nickname};
      });
      await audit(me.id,action==="revokeAllSessions"?"REVOKE_ALL_SESSIONS":"REVOKE_USER_SESSIONS",action==="revokeAllSessions"?"PLATFORM":"USER",action==="revokeAllSessions"?undefined:userId,result);
      return NextResponse.json({ok:true,...result});
    }

    if(action==="platformSetting"){
      if(adminLevel(me.role)<5)return NextResponse.json({error:"Только SUPERADMIN"},{status:403});
      const key=String(body.key??"");
      const validation=validatePlatformSettingValue(key,body.value);
      if(!validation.ok)return NextResponse.json({error:"Некорректное значение",errorCode:validation.error},{status:400});
      const current=await prisma.platformSetting.findMany({where:{key:{in:["MIN_STAKE","MAX_STAKE"]}}});
      const values:Record<string,number>=Object.fromEntries(current.map(row=>[row.key,Number(row.value)]));
      values[key]=validation.value;
      if(key==="MIN_STAKE"||key==="MAX_STAKE"){const relation=validatePlatformSettingRelationships(values);if(!relation.ok)return NextResponse.json({error:"MIN_STAKE не может быть больше MAX_STAKE",errorCode:relation.error},{status:400});}
      const rule=PLATFORM_SETTING_RULES[key as keyof typeof PLATFORM_SETTING_RULES];
      const old=await prisma.platformSetting.findUnique({where:{key}});
      const row=await prisma.platformSetting.upsert({where:{key},update:{value:validation.value,minValue:rule.min,maxValue:rule.max,step:rule.step,updatedBy:me.id},create:{key,value:validation.value,minValue:rule.min,maxValue:rule.max,step:rule.step,updatedBy:me.id}});
      await audit(me.id,"CHANGE_PLATFORM_SETTING","PLATFORM_SETTING",row.id,{key,old:old?.value?.toString()??null,new:validation.value});
      return NextResponse.json({ok:true,row});
    }
    if(action==="featureFlag"){
      if(adminLevel(me.role)<5)return NextResponse.json({error:"Только SUPERADMIN"},{status:403});
      const validation=validateFeatureFlagPayload(body);
      if(!validation.ok)return NextResponse.json({error:"Некорректный feature flag",errorCode:validation.error},{status:400});
      const row=await prisma.featureFlag.upsert({where:{key:validation.key},update:{enabled:validation.enabled,updatedBy:me.id},create:{key:validation.key,enabled:validation.enabled,updatedBy:me.id}});
      await audit(me.id,"CHANGE_FEATURE_FLAG","FEATURE_FLAG",row.id,{key:validation.key,enabled:validation.enabled});
      return NextResponse.json({ok:true,row});
    }

    if(action==="standardTheme"){
      if(adminLevel(me.role)<3)return NextResponse.json({error:"Недостаточно прав"},{status:403});
      const theme=String(body.theme||"");
      if(!THEMES.some(t=>t.id===theme))return NextResponse.json({error:"Неизвестная тема"},{status:400});
      await prisma.siteSettings.upsert({where:{key:"standardTheme"},update:{value:{id:theme},updatedBy:me.id},create:{key:"standardTheme",value:{id:theme},updatedBy:me.id,description:"Стандартная тема сайта"}});
      await audit(me.id,"CHANGE_STANDARD_THEME","SITE_SETTINGS",undefined,{theme});
      return NextResponse.json({ok:true,theme});
    }

    if(action==="backgroundTheme"){
      if(adminLevel(me.role)<5)return NextResponse.json({error:"Только SUPERADMIN"},{status:403});
      const background=String(body.background||"stars");
      const allowed=["stars","blue-nebula","green-aurora","purple-galaxy","gold-space"];
      if(!allowed.includes(background))return NextResponse.json({error:"Неизвестный фон"},{status:400});
      await prisma.siteSettings.upsert({where:{key:"backgroundTheme"},update:{value:{id:background},updatedBy:me.id},create:{key:"backgroundTheme",value:{id:background},updatedBy:me.id,description:"Фоновая атмосфера сайта"}});
      await audit(me.id,"CHANGE_BACKGROUND_THEME","SITE_SETTINGS",undefined,{background});
      return NextResponse.json({ok:true,background});
    }

    if(action==="heroBackground"){
      if(adminLevel(me.role)<5)return NextResponse.json({error:"Только SUPERADMIN"},{status:403});
      const hero=String(body.hero||"");
      const allowed=Array.from({length:10},(_,i)=>`hero-${String(i+1).padStart(2,"0")}`);
      if(!allowed.includes(hero))return NextResponse.json({error:"Неизвестная главная картинка"},{status:400});
      await prisma.siteSettings.upsert({where:{key:"heroBackground"},update:{value:{id:hero},updatedBy:me.id},create:{key:"heroBackground",value:{id:hero},updatedBy:me.id,description:"Главная картинка DuelPlay"}});
      await audit(me.id,"CHANGE_HERO_BACKGROUND","SITE_SETTINGS",undefined,{hero});
      return NextResponse.json({ok:true,hero});
    }

    if(action==="sendNotification"){
      if(adminLevel(me.role)<3)return NextResponse.json({error:"Недостаточно прав"},{status:403});
      const title=String(body.title||"").trim().slice(0,120);
      const message=String(body.body||"").trim().slice(0,600);
      const target=String(body.target||"ALL");
      if(!title||!message)return NextResponse.json({error:"Заполни заголовок и текст уведомления"},{status:400});
      let ids:string[]=[];
      if(target==="ALL") ids=(await prisma.user.findMany({where:{status:"ACTIVE"},select:{id:true}})).map(x=>x.id);
      else ids=[target];
      if(!ids.length)return NextResponse.json({error:"Получатели не найдены"},{status:404});
      await prisma.notification.createMany({data:ids.map(userId=>({userId,type:"SYSTEM",status:"UNREAD",title,body:message,payload:{sentBy:me.nickname}}))});
      await audit(me.id,"SEND_SYSTEM_NOTIFICATION","NOTIFICATION",undefined,{target,count:ids.length,title});
      return NextResponse.json({ok:true,count:ids.length});
    }

    if(action==="topSkinAdd"){
      if(adminLevel(me.role)<3)return NextResponse.json({error:"Недостаточно прав"},{status:403});
      const name=String(body.name||"").trim().slice(0,100);
      const imageData=String(body.imageData||"");
      if(!name||!imageData.startsWith("data:image/"))return NextResponse.json({error:"Нужны название и изображение"},{status:400});
      if(imageData.length>3_000_000)return NextResponse.json({error:"Изображение слишком большое"},{status:400});
      const skin=await prisma.topSkin.create({data:{name,imageData,submittedBy:me.nickname,sortOrder:0}});
      await audit(me.id,"ADD_TOP_SKIN","TOP_SKIN",skin.id,{name});
      return NextResponse.json({ok:true,skin});
    }

    if(action==="topSkinDelete"){
      if(adminLevel(me.role)<3)return NextResponse.json({error:"Недостаточно прав"},{status:403});
      const id=String(body.id||"");
      await prisma.topSkin.delete({where:{id}});
      await audit(me.id,"DELETE_TOP_SKIN","TOP_SKIN",id);
      return NextResponse.json({ok:true});
    }

    if(action==="avatarPresetAdd"){
      if(adminLevel(me.role)<3)return NextResponse.json({error:"Недостаточно прав"},{status:403});
      const name=String(body.name||"").trim().slice(0,100); const imageData=String(body.imageData||"");
      if(!name||!imageData.startsWith("data:image/"))return NextResponse.json({error:"Нужны название и изображение"},{status:400});
      if(imageData.length>3_000_000)return NextResponse.json({error:"Изображение слишком большое"},{status:400});
      const avatar=await prisma.avatarPreset.create({data:{name,imageData,submittedBy:me.nickname,sortOrder:0}});
      await audit(me.id,"ADD_AVATAR_PRESET","AVATAR_PRESET",avatar.id,{name}); return NextResponse.json({ok:true,avatar});
    }
    if(action==="avatarPresetDelete"){
      if(adminLevel(me.role)<3)return NextResponse.json({error:"Недостаточно прав"},{status:403});
      const id=String(body.id||""); await prisma.avatarPreset.delete({where:{id}}); await audit(me.id,"DELETE_AVATAR_PRESET","AVATAR_PRESET",id); return NextResponse.json({ok:true});
    }

    if(action==="fraudReview"){
      if(adminLevel(me.role)<3)return NextResponse.json({error:"Недостаточно прав"},{status:403});
      const id=String(body.fraudCaseId||""); const status=String(body.status||"");
      if(!id||!["DETECTED","UNDER_INVESTIGATION","CONFIRMED_BANNED","FALSE_POSITIVE_CLEARED"].includes(status))return NextResponse.json({error:"Некорректный fraud status"},{status:400});
      const result=await prisma.$transaction(async tx=>{
        const fraud=await tx.fraudCase.findUnique({where:{id},select:{id:true,userId:true,status:true,riskScore:true}});
        if(!fraud)throw new Error("FRAUD_NOT_FOUND");
        const user=await tx.user.findUnique({where:{id:fraud.userId},select:{id:true,steamId:true,nickname:true,role:true,status:true}});
        if(!user)throw new Error("USER_NOT_FOUND");
        if((status==="CONFIRMED_BANNED")&&protectedOwner(user))throw new Error("OWNER_TARGET");
        const updated=await tx.fraudCase.update({where:{id},data:{status:status as never,closedAt:["CONFIRMED_BANNED","FALSE_POSITIVE_CLEARED"].includes(status)?new Date():null,adminResult:{reviewedBy:me.id,reviewedByNickname:me.nickname,status}}});
        if(status==="CONFIRMED_BANNED")await tx.user.update({where:{id:user.id},data:{status:"BANNED"}});
        if(status==="FALSE_POSITIVE_CLEARED"&&user.status==="SUSPENDED")await tx.user.update({where:{id:user.id},data:{status:"ACTIVE"}});
        return updated;
      });
      await audit(me.id,"REVIEW_FRAUD_CASE","FRAUD_CASE",id,{status});
      return NextResponse.json({ok:true,fraudCase:result});
    }

    if(action==="userStatus"){
      if(adminLevel(me.role)<2)return NextResponse.json({error:"Недостаточно прав"},{status:403});
      const id=String(body.userId),status=String(body.status);
      const target=await prisma.user.findUnique({where:{id},select:{steamId:true,nickname:true,role:true}});
      if(target&&protectedOwner(target))return NextResponse.json({error:"Главный администратор защищён и не может быть изменён."},{status:403});
      if(!["PENDING","ACTIVE","SUSPENDED","BANNED","DEACTIVATED"].includes(status))return NextResponse.json({error:"Неверный статус"},{status:400});
      const u=await prisma.user.update({where:{id},data:{status:status as never},select:{id:true,nickname:true,status:true}});
      await audit(me.id,"CHANGE_USER_STATUS","USER",id,{status});return NextResponse.json({ok:true,user:u});
    }

    if(action==="userRole"){
      if(adminLevel(me.role)<5)return NextResponse.json({error:"Только SUPERADMIN"},{status:403});
      const id=String(body.userId),role=String(body.role);
      const target=await prisma.user.findUnique({where:{id},select:{steamId:true,nickname:true,role:true}});
      if(target&&protectedOwner(target))return NextResponse.json({error:"Главный администратор защищён и не может быть изменён."},{status:403});
      if(!["USER","SUPPORT","MODERATOR","ADMIN","SUPERADMIN"].includes(role))return NextResponse.json({error:"Неверная роль"},{status:400});
      const u=await prisma.user.update({where:{id},data:{role:role as never},select:{id:true,nickname:true,role:true}});
      await audit(me.id,"CHANGE_USER_ROLE","USER",id,{role});return NextResponse.json({ok:true,user:u});
    }

    if(action==="walletAdjust"){
      const id=String(body.userId), amount=Number(body.amount), reason=String(body.reason||"").trim().slice(0,240);
      if(!Number.isFinite(amount)||amount===0)return NextResponse.json({error:"Укажи корректную сумму"},{status:400});
      if(amount>0 && adminLevel(me.role)<3)return NextResponse.json({error:"Недостаточно прав"},{status:403});
      const result=await prisma.$transaction(async tx=>{
        const target=await tx.user.findUnique({where:{id},select:{id:true,nickname:true,steamId:true,wallet:{select:{id:true,balance:true,lockedBalance:true}}}});
        if(!target?.wallet)throw new Error("WALLET");
        const targetLock=(await tx.$queryRaw<Array<{id:string;balance:any;lockedBalance:any}>>`SELECT id,balance,"lockedBalance" FROM "Wallet" WHERE id=${target.wallet.id}::uuid FOR UPDATE`)[0];
        if(!targetLock)throw new Error("WALLET");
        if(target.nickname==="DuelPlayOwner" || (OWNER_STEAM_ID && target.steamId===OWNER_STEAM_ID))throw new Error("OWNER_TARGET");
        const before=Number(targetLock.balance);
        if(amount<0){
          const debit=Math.abs(amount);
          if(before<debit)throw new Error("INSUFFICIENT_BALANCE");
          let owner=OWNER_STEAM_ID?await tx.user.findUnique({where:{steamId:OWNER_STEAM_ID},select:{id:true,nickname:true,wallet:{select:{id:true,balance:true}}}}):null;
          if(!owner){
            owner=await tx.user.findFirst({where:{role:"SUPERADMIN",status:"ACTIVE",wallet:{isNot:null}},orderBy:{createdAt:"asc"},select:{id:true,nickname:true,wallet:{select:{id:true,balance:true}}}});
          }
          if(!owner?.wallet)throw new Error("OWNER_WALLET");
          const ownerLock=(await tx.$queryRaw<Array<{id:string;balance:any;lockedBalance:any}>>`SELECT id,balance,"lockedBalance" FROM "Wallet" WHERE id=${owner.wallet.id}::uuid FOR UPDATE`)[0];
          if(!ownerLock)throw new Error("OWNER_WALLET");
          const adjustmentKey=`admin-adjust:${id}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
          const targetDebit=await debitWallet(tx,target.id,debit,adjustmentKey,"WITHDRAW",`Админ ${me.nickname} списал $${debit.toFixed(2)} у игрока ${target.nickname}${reason?` · ${reason}`:""}`,id);
          if(targetDebit.idempotent) throw new Error("IDEMPOTENCY_CONFLICT");
          const ownerCredit=await creditWallet(tx,owner.id,debit,`${adjustmentKey}:owner`,"DEPOSIT",`Админ ${me.nickname} получил $${debit.toFixed(2)} со счёта игрока ${target.nickname}${reason?` · ${reason}`:""}`,id);
          if(ownerCredit.idempotent) throw new Error("IDEMPOTENCY_CONFLICT");
          return {balance:Number(targetDebit.transaction.balanceAfter),ownerNickname:owner.nickname};
        }
        const desc=`Админ ${me.nickname} зачислил $${amount.toFixed(2)} игроку ${target.nickname}${reason?` · ${reason}`:""}`;
        const adjustmentKey=`admin-credit:${id}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        const credited=await creditWallet(tx,target.id,amount,adjustmentKey,"DEPOSIT",desc,id);
        if(credited.idempotent) throw new Error("IDEMPOTENCY_CONFLICT");
        return {balance:Number(credited.transaction.balanceAfter),ownerNickname:null};
      });
      await audit(me.id,"WALLET_ADJUST","USER",id,{amount,reason});
      return NextResponse.json({ok:true,balance:result.balance.toFixed(4),ownerNickname:result.ownerNickname});
    }

    if(action==="withdrawalStatus"){
      if(adminLevel(me.role)<3)return NextResponse.json({error:"Недостаточно прав"},{status:403});
      const id=String(body.id||""),status=String(body.status||"");
      if(!["PROCESSING","COMPLETED","FAILED","REJECTED"].includes(status))return NextResponse.json({error:"Неверный статус"},{status:400});
      const row=await prisma.$transaction(async tx=>{const w=await tx.withdrawal.findUnique({where:{id}});if(!w)throw new Error("NOT_FOUND");if(["COMPLETED","REJECTED","FAILED"].includes(w.status))return w;const walletRows=await tx.$queryRaw<Array<{id:string;balance:any;lockedBalance:any}>>`SELECT id,balance,"lockedBalance" FROM "Wallet" WHERE id=${w.walletId} FOR UPDATE`;const wallet=walletRows[0];if(!wallet)throw new Error("WALLET");const amount=Number(w.amount),locked=Number(wallet.lockedBalance);if(!Number.isFinite(amount)||amount<=0||locked+1e-9<amount)throw new Error("LOCKED_STAKE");const updated=await tx.withdrawal.update({where:{id},data:{status:status as never,reviewReason:String(body.reason||"")}});if(["REJECTED","FAILED"].includes(status)){const owner=await tx.wallet.findUniqueOrThrow({where:{id:w.walletId},select:{userId:true}});await creditWallet(tx,owner.userId,amount,`withdraw-refund:${w.id}`,"REFUND",`Withdrawal ${status.toLowerCase()} refund`,w.id);await tx.wallet.update({where:{id:w.walletId},data:{lockedBalance:{decrement:amount}}});}else if(status==="COMPLETED"){await tx.wallet.update({where:{id:w.walletId},data:{lockedBalance:{decrement:amount}}});}return updated;});await audit(me.id,"WITHDRAWAL_STATUS","WITHDRAWAL",id,{status});return NextResponse.json(row);
    }
    if(action==="depositStatus"){
      if(adminLevel(me.role)<3)return NextResponse.json({error:"Недостаточно прав"},{status:403});const id=String(body.id||""),status=String(body.status||"");if(!["PROCESSING","COMPLETED","FAILED","EXPIRED"].includes(status))return NextResponse.json({error:"Неверный статус"},{status:400});const row=await prisma.$transaction(async tx=>{const d=await tx.deposit.findUnique({where:{id}});if(!d)throw new Error("NOT_FOUND");if(d.status==="COMPLETED")return d;const updated=await tx.deposit.update({where:{id},data:{status:status as never}});if(status==="COMPLETED"){const owner=await tx.wallet.findUniqueOrThrow({where:{id:d.walletId},select:{userId:true}});await creditWallet(tx,owner.userId,Number(d.amount),`deposit:${d.providerTxId}`,"DEPOSIT","Deposit approved by admin",d.id);await grantDepositBonus(tx,owner.userId,d.id,Number(d.amount),String(d.provider));}return updated;});await audit(me.id,"DEPOSIT_STATUS","DEPOSIT",id,{status});return NextResponse.json(row);
    }

    if(action==="supportReply"){
      if(adminLevel(me.role)<1)return NextResponse.json({error:"Недостаточно прав"},{status:403});
      const ticketId=String(body.ticketId||""), message=String(body.message||"").trim().slice(0,3000);
      if(!ticketId||!message)return NextResponse.json({error:"Нужен текст ответа"},{status:400});
      const ticket=await prisma.supportTicket.findUnique({where:{id:ticketId}});
      if(!ticket)return NextResponse.json({error:"Обращение не найдено"},{status:404});
      await prisma.ticketMessage.create({data:{ticketId,senderId:me.id,message}});
      await prisma.supportTicket.update({where:{id:ticketId},data:{status:"WAITING_ON_USER",assignedToId:me.id}});
      await prisma.notification.create({data:{userId:ticket.userId,type:"SYSTEM",status:"UNREAD",title:"Ответ поддержки",body:message,payload:{ticketId,kind:"SUPPORT_REPLY",subject:ticket.subject}}});
      await audit(me.id,"SUPPORT_REPLY","SUPPORT_TICKET",ticketId,{});
      return NextResponse.json({ok:true});
    }
    if(action==="supportDelete"){
      if(adminLevel(me.role)<5)return NextResponse.json({error:"Удалять обращения может только SUPERADMIN"},{status:403});
      const ticketId=String(body.ticketId||"").trim();
      if(!ticketId)return NextResponse.json({error:"Обращение не найдено"},{status:400});
      const ticket=await prisma.supportTicket.findUnique({where:{id:ticketId},select:{id:true,subject:true}});
      if(!ticket)return NextResponse.json({error:"Обращение не найдено"},{status:404});
      await prisma.supportTicket.delete({where:{id:ticketId}});
      await audit(me.id,"DELETE_SUPPORT_TICKET","SUPPORT_TICKET",ticketId,{subject:ticket.subject});
      return NextResponse.json({ok:true});
    }

    if(action==="supportStatus"){
      if(adminLevel(me.role)<1)return NextResponse.json({error:"Недостаточно прав"},{status:403});
      const ticketId=String(body.ticketId||""), status=String(body.status||"");
      const allowed=["OPEN","ASSIGNED","IN_PROGRESS","WAITING_ON_USER","RESOLVED","CLOSED"];
      if(!allowed.includes(status))return NextResponse.json({error:"Неверный статус"},{status:400});
      const ticket=await prisma.supportTicket.findUnique({where:{id:ticketId}});
      if(!ticket)return NextResponse.json({error:"Обращение не найдено"},{status:404});
      const updatedTicket=await prisma.supportTicket.update({where:{id:ticketId},data:{status:status as never,assignedToId:status==="OPEN"?null:me.id}});
      if(["RESOLVED","CLOSED"].includes(status) && !["RESOLVED","CLOSED"].includes(ticket.status)){
        await prisma.notification.create({data:{userId:ticket.userId,type:"SYSTEM",status:"UNREAD",title:"Обращение закрыто",body:`Обращение «${ticket.subject}» закрыто поддержкой.`,payload:{ticketId,status,kind:"SUPPORT_CLOSED",subject:ticket.subject}}});
      }
      await audit(me.id,"SUPPORT_STATUS","SUPPORT_TICKET",ticketId,{status});
      return NextResponse.json({ok:true,ticket:updatedTicket});
    }

    if(action==="cancelMatch"){
        if(adminLevel(me.role)<3)return NextResponse.json({error:"Недостаточно прав"},{status:403});
        const id=String(body.matchId);
        const match=await prisma.match.findUnique({where:{id},include:{gameServer:true}});
        if(!match)return NextResponse.json({error:"Матч не найден"},{status:404});
        if(["CANCELLED","FINISHED","COMPLETED"].includes(match.status))return NextResponse.json({error:"Матч уже завершён"},{status:409});

        const amount=Number(match.betAmount);
        await prisma.$transaction(async tx=>{
          for(const uid of [match.playerOneId,match.playerTwoId].filter(Boolean) as string[]){
            const w=await tx.wallet.findUnique({where:{userId:uid}});
            if(w){
              const locked=(await tx.$queryRaw<Array<{id:string;balance:any;lockedBalance:any}>>`SELECT id,balance,"lockedBalance" FROM "Wallet" WHERE id=${w.id} FOR UPDATE`)[0];
              if(!locked) continue;
              if(Number(locked.lockedBalance)+1e-9<amount) throw new Error("LOCKED_STAKE");
              const owner=await tx.wallet.findUniqueOrThrow({where:{id:w.id},select:{userId:true}});
              await creditWallet(tx,owner.userId,amount,`admin-refund:${id}:${uid}`,"REFUND","Admin match refund",id);
              await tx.wallet.update({where:{id:w.id},data:{lockedBalance:{decrement:amount}}});
            }
          }
          if(match.gameServer){
            await tx.gameServer.update({
              where:{id:match.gameServer.id},
              data:{
                status:"OFFLINE",
                matchId:null,
                processId:null,
                startedAt:null,
                stoppedAt:new Date(),
                lastHeartbeat:null
              }
            });
          }
          await tx.match.update({
            where:{id},
            data:{status:"CANCELLED",endedAt:new Date(),serverConfig:Prisma.JsonNull}
          });
        });
        await audit(me.id,"CANCEL_MATCH","MATCH",id);
        return NextResponse.json({ok:true});
      }
return NextResponse.json({error:"Неизвестное действие"},{status:400});
  }catch(e){
    if(e instanceof Error&&e.message==="FORBIDDEN")return NextResponse.json({error:"Недостаточно прав"},{status:403});
    if(e instanceof Error&&e.message==="WALLET")return NextResponse.json({error:"Кошелёк не найден"},{status:404});
    if(e instanceof Error&&e.message==="INSUFFICIENT_BALANCE")return NextResponse.json({error:"У игрока недостаточно доступных средств"},{status:400});
    if(e instanceof Error&&e.message==="OWNER_TARGET")return NextResponse.json({error:"Защищённый аккаунт владельца нельзя изменить"},{status:403});
    if(e instanceof Error&&e.message==="USER_NOT_FOUND")return NextResponse.json({error:"Пользователь не найден"},{status:404});
    if(e instanceof Error&&e.message==="OWNER_WALLET")return NextResponse.json({error:"Кошелёк владельца SUPERADMIN не найден"},{status:500});
    console.error(e);return NextResponse.json({error:"Операция не выполнена"},{status:500});
  }
}
