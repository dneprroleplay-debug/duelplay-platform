import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin, adminLevel, audit } from "@/lib/admin";
import { THEMES, themeById } from "@/lib/themes";

const OWNER_STEAM_ID = process.env.DUELPLAY_OWNER_STEAM_ID?.trim();

export async function GET(){
  try{
    const me=await requireAdmin(1);
    const [users,matches,transactions,disputes,fraud,tickets,settings,topSkins,servers,logs,avatarPresets]=await Promise.all([
      prisma.user.findMany({orderBy:{createdAt:"desc"},take:100,select:{id:true,nickname:true,email:true,role:true,status:true,createdAt:true,steamId:true,wallet:{select:{balance:true,lockedBalance:true}}}}),
      prisma.match.findMany({orderBy:{createdAt:"desc"},take:100,include:{playerOne:{select:{nickname:true}},playerTwo:{select:{nickname:true}},game:{select:{title:true}}}}),
      prisma.transaction.findMany({orderBy:{createdAt:"desc"},take:100,include:{wallet:{include:{user:{select:{nickname:true}}}}}}),
      prisma.dispute.findMany({orderBy:{createdAt:"desc"},take:50,include:{match:true,reporter:{select:{nickname:true}}}}),
      prisma.fraudCase.findMany({orderBy:{createdAt:"desc"},take:50,include:{user:{select:{nickname:true}}}}),
      prisma.supportTicket.findMany({orderBy:{createdAt:"desc"},take:50,include:{user:{select:{nickname:true}}}}),
      prisma.siteSettings.findMany({where:{key:{in:["standardTheme","backgroundTheme"]}}}),
      prisma.topSkin.findMany({orderBy:[{sortOrder:"asc"},{createdAt:"desc"}],take:40}),
      prisma.gameServer.findMany({orderBy:{createdAt:"asc"},include:{match:{select:{id:true,status:true,mapName:true,playerOne:{select:{nickname:true}},playerTwo:{select:{nickname:true}}}}}}),
      prisma.auditLog.findMany({orderBy:{createdAt:"desc"},take:100,include:{user:{select:{nickname:true}}}}),
      prisma.avatarPreset.findMany({orderBy:[{sortOrder:"asc"},{createdAt:"desc"}],take:60})
    ]);
    const row=settings.find(x=>x.key==="standardTheme");
    const standard=typeof row?.value==="object"&&row?.value&&"id" in row.value?String((row.value as {id?:unknown}).id):"STANDARD";
    const level=adminLevel(me.role);
    const userRows=users.map(u=>({...u,balance:Number(u.wallet?.balance??0),lockedBalance:Number(u.wallet?.lockedBalance??0),wallet:undefined}));
    const bgRow=settings.find(x=>x.key==="backgroundTheme");
    const background=typeof bgRow?.value==="object"&&bgRow?.value&&"id" in bgRow.value?String((bgRow.value as {id?:unknown}).id):"stars";
    return NextResponse.json({me:{nickname:me.nickname,role:me.role,level},themes:THEMES,standardTheme:themeById(standard).id,backgroundTheme:background,users:level>=2?userRows:[],matches:level>=2?matches:[],transactions:level>=3?transactions:[],disputes:level>=2?disputes:[],fraud:level>=2?fraud:[],tickets,topSkins:level>=3?topSkins:[],servers:level>=3?servers:[],logs:level>=3?logs:[],avatarPresets:level>=3?avatarPresets:[]});
  }catch(e){
    if(e instanceof Error&&e.message==="FORBIDDEN")return NextResponse.json({error:"Недостаточно прав"},{status:403});
    console.error(e);return NextResponse.json({error:"Не удалось загрузить админку"},{status:500});
  }
}

export async function PATCH(request:NextRequest){
  try{
    const me=await requireAdmin(3);
    const body=await request.json();
    const action=String(body.action||"");

    if(action==="standardTheme"){
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

    if(action==="userStatus"){
      if(adminLevel(me.role)<2)return NextResponse.json({error:"Недостаточно прав"},{status:403});
      const id=String(body.userId),status=String(body.status);
      if(!["PENDING","ACTIVE","SUSPENDED","BANNED","DEACTIVATED"].includes(status))return NextResponse.json({error:"Неверный статус"},{status:400});
      const u=await prisma.user.update({where:{id},data:{status:status as never},select:{id:true,nickname:true,status:true}});
      await audit(me.id,"CHANGE_USER_STATUS","USER",id,{status});return NextResponse.json({ok:true,user:u});
    }

    if(action==="userRole"){
      if(adminLevel(me.role)<5)return NextResponse.json({error:"Только SUPERADMIN"},{status:403});
      const id=String(body.userId),role=String(body.role);
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
        const before=Number(target.wallet.balance);
        if(amount<0){
          const debit=Math.abs(amount);
          if(before<debit)throw new Error("INSUFFICIENT_BALANCE");
          if(target.steamId && OWNER_STEAM_ID && target.steamId===OWNER_STEAM_ID)throw new Error("OWNER_TARGET");
          let owner=OWNER_STEAM_ID?await tx.user.findUnique({where:{steamId:OWNER_STEAM_ID},select:{id:true,nickname:true,wallet:{select:{id:true,balance:true}}}}):null;
          if(!owner){
            owner=await tx.user.findFirst({where:{role:"SUPERADMIN",status:"ACTIVE",wallet:{isNot:null}},orderBy:{createdAt:"asc"},select:{id:true,nickname:true,wallet:{select:{id:true,balance:true}}}});
          }
          if(!owner?.wallet)throw new Error("OWNER_WALLET");
          const after=Number((before-debit).toFixed(4));
          const ownerBefore=Number(owner.wallet.balance),ownerAfter=Number((ownerBefore+debit).toFixed(4));
          await tx.wallet.update({where:{id:target.wallet.id},data:{balance:after}});
          await tx.wallet.update({where:{id:owner.wallet.id},data:{balance:ownerAfter}});
          const descTarget=`Админ ${me.nickname} списал $${debit.toFixed(2)} у игрока ${target.nickname}${reason?` · ${reason}`:""}`;
          const descOwner=`Админ ${me.nickname} получил $${debit.toFixed(2)} со счёта игрока ${target.nickname}${reason?` · ${reason}`:""}`;
          await tx.transaction.create({data:{walletId:target.wallet.id,type:"WITHDRAW",status:"COMPLETED",amount:-debit,balanceBefore:before,balanceAfter:after,description:descTarget}});
          await tx.transaction.create({data:{walletId:owner.wallet.id,type:"DEPOSIT",status:"COMPLETED",amount:debit,balanceBefore:ownerBefore,balanceAfter:ownerAfter,description:descOwner}});
          return {balance:after,ownerNickname:owner.nickname};
        }
        const after=Number((before+amount).toFixed(4));
        await tx.wallet.update({where:{id:target.wallet.id},data:{balance:after}});
        const desc=`Админ ${me.nickname} зачислил $${amount.toFixed(2)} игроку ${target.nickname}${reason?` · ${reason}`:""}`;
        await tx.transaction.create({data:{walletId:target.wallet.id,type:"DEPOSIT",status:"COMPLETED",amount,balanceBefore:before,balanceAfter:after,description:desc}});
        return {balance:after,ownerNickname:null};
      });
      await audit(me.id,"WALLET_ADJUST","USER",id,{amount,reason});
      return NextResponse.json({ok:true,balance:result.balance.toFixed(4),ownerNickname:result.ownerNickname});
    }

    if(action==="cancelMatch"){
        const id=String(body.matchId);
        const match=await prisma.match.findUnique({where:{id},include:{gameServer:true}});
        if(!match)return NextResponse.json({error:"Матч не найден"},{status:404});
        if(["CANCELLED","FINISHED","COMPLETED"].includes(match.status))return NextResponse.json({error:"Матч уже завершён"},{status:409});

        const amount=Number(match.betAmount);
        await prisma.$transaction(async tx=>{
          for(const uid of [match.playerOneId,match.playerTwoId].filter(Boolean) as string[]){
            const w=await tx.wallet.findUnique({where:{userId:uid}});
            if(w){
              const before=Number(w.balance);
              const after=Number((before+amount).toFixed(4));
              await tx.wallet.update({where:{id:w.id},data:{balance:after,lockedBalance:{decrement:amount}}});
              await tx.transaction.create({data:{
                walletId:w.id,type:"REFUND",status:"COMPLETED",amount,
                balanceBefore:before,balanceAfter:after,referenceId:id,
                description:"\u0412\u043e\u0437\u0432\u0440\u0430\u0442 \u0441\u0442\u0430\u0432\u043a\u0438 \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440\u043e\u043c"
              }});
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
    if(e instanceof Error&&e.message==="OWNER_TARGET")return NextResponse.json({error:"Нельзя списывать средства с кошелька владельца"},{status:400});
    if(e instanceof Error&&e.message==="OWNER_WALLET")return NextResponse.json({error:"Кошелёк владельца SUPERADMIN не найден"},{status:500});
    console.error(e);return NextResponse.json({error:"Операция не выполнена"},{status:500});
  }
}
