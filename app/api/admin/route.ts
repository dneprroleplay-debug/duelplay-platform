import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, adminLevel, audit } from "@/lib/admin";
import { THEMES, themeById } from "@/lib/themes";

export async function GET(){
  try{
    const me=await requireAdmin(1);
    const [users,matches,transactions,disputes,fraud,tickets,settings]=await Promise.all([
      prisma.user.findMany({orderBy:{createdAt:"desc"},take:100,select:{id:true,nickname:true,email:true,role:true,status:true,createdAt:true,wallet:{select:{balance:true,lockedBalance:true}}}}),
      prisma.match.findMany({orderBy:{createdAt:"desc"},take:100,include:{playerOne:{select:{nickname:true}},playerTwo:{select:{nickname:true}},game:{select:{title:true}}}}),
      prisma.transaction.findMany({orderBy:{createdAt:"desc"},take:100,include:{wallet:{include:{user:{select:{nickname:true}}}}}}),
      prisma.dispute.findMany({orderBy:{createdAt:"desc"},take:50,include:{match:true,reporter:{select:{nickname:true}}}}),
      prisma.fraudCase.findMany({orderBy:{createdAt:"desc"},take:50,include:{user:{select:{nickname:true}}}}),
      prisma.supportTicket.findMany({orderBy:{createdAt:"desc"},take:50,include:{user:{select:{nickname:true}}}}),
      prisma.siteSettings.findMany({where:{key:{in:["standardTheme","standardAccent"]}}})
    ]);
    const row=settings.find((x: {key:string; value:unknown})=>x.key==="standardTheme"); const standard=typeof row?.value==="object"&&row?.value&&"id" in row.value?String((row.value as any).id):"STANDARD";
    const accentRow=settings.find((x: {key:string; value:unknown})=>x.key==="standardAccent"); const accent=typeof accentRow?.value==="object"&&accentRow?.value&&"hex" in accentRow.value?String((accentRow.value as any).hex):themeById(standard).accent;
    const level=adminLevel(me.role);
    const userRows=users.map((u: (typeof users)[number])=>({...u,balance:Number(u.wallet?.balance??0),lockedBalance:Number(u.wallet?.lockedBalance??0),wallet:undefined}));
    return NextResponse.json({me:{nickname:me.nickname,role:me.role,level},themes:THEMES,standardTheme:themeById(standard).id,standardAccent:accent,users:level>=2?userRows:[],matches:level>=2?matches:[],transactions:level>=3?transactions:[],disputes:level>=2?disputes:[],fraud:level>=2?fraud:[],tickets});
  }catch(e){if(e instanceof Error&&e.message==="FORBIDDEN")return NextResponse.json({error:"РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ РїСЂР°РІ"},{status:403});console.error(e);return NextResponse.json({error:"РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ Р°РґРјРёРЅРєСѓ"},{status:500})}
}

export async function PATCH(request:NextRequest){
  try{
    const me=await requireAdmin(3); const body=await request.json(); const action=String(body.action||"");
    if(action==="standardAccent") {
      const hex=String(body.hex||""); if(!/^#[0-9a-fA-F]{6}$/.test(hex)) return NextResponse.json({error:"Р¦РІРµС‚ РґРѕР»Р¶РµРЅ Р±С‹С‚СЊ РІ С„РѕСЂРјР°С‚Рµ #RRGGBB"},{status:400});
      await prisma.siteSettings.upsert({where:{key:"standardAccent"},update:{value:{hex},updatedBy:me.id},create:{key:"standardAccent",value:{hex},updatedBy:me.id,description:"Р”РѕРїРѕР»РЅРёС‚РµР»СЊРЅС‹Р№ Р°РєС†РµРЅС‚ СЃС‚Р°РЅРґР°СЂС‚РЅРѕРіРѕ СЃС‚РёР»СЏ"}});
      await audit(me.id,"CHANGE_STANDARD_ACCENT","SITE_SETTINGS",undefined,{hex}); return NextResponse.json({ok:true,accent:hex});
    }
    if(action==="standardTheme"){
      const theme=String(body.theme||""); if(!THEMES.some(t=>t.id===theme)) return NextResponse.json({error:"РќРµРёР·РІРµСЃС‚РЅР°СЏ С‚РµРјР°"},{status:400});
      await prisma.siteSettings.upsert({where:{key:"standardTheme"},update:{value:{id:theme},updatedBy:me.id},create:{key:"standardTheme",value:{id:theme},updatedBy:me.id,description:"РўРµРјР° РґР»СЏ РїРѕР»СЊР·РѕРІР°С‚РµР»РµР№ СЃРѕ СЃС‚Р°РЅРґР°СЂС‚РЅС‹Рј СЃС‚РёР»РµРј"}}); await audit(me.id,"CHANGE_STANDARD_THEME","SITE_SETTINGS",undefined,{theme}); return NextResponse.json({ok:true,theme});
    }
    if(action==="userStatus"){
      if(adminLevel(me.role)<2)return NextResponse.json({error:"РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ РїСЂР°РІ"},{status:403}); const id=String(body.userId),status=String(body.status); if(!["PENDING","ACTIVE","SUSPENDED","BANNED","DEACTIVATED"].includes(status))return NextResponse.json({error:"РќРµРІРµСЂРЅС‹Р№ СЃС‚Р°С‚СѓСЃ"},{status:400}); const u=await prisma.user.update({where:{id},data:{status:status as any},select:{id:true,nickname:true,status:true}}); await audit(me.id,"CHANGE_USER_STATUS","USER",id,{status}); return NextResponse.json({ok:true,user:u});
    }
    if(action==="userRole"){
      if(adminLevel(me.role)<5)return NextResponse.json({error:"РўРѕР»СЊРєРѕ SUPERADMIN"},{status:403}); const id=String(body.userId),role=String(body.role); if(!["USER","MODERATOR","SUPPORT","ADMIN","SUPERADMIN"].includes(role))return NextResponse.json({error:"РќРµРІРµСЂРЅР°СЏ СЂРѕР»СЊ"},{status:400}); const u=await prisma.user.update({where:{id},data:{role:role as any},select:{id:true,nickname:true,role:true}}); await audit(me.id,"CHANGE_USER_ROLE","USER",id,{role}); return NextResponse.json({ok:true,user:u});
    }
    if(action==="walletAdjust"){
      const id=String(body.userId), amount=Number(body.amount); if(!Number.isFinite(amount)||amount===0)return NextResponse.json({error:"РЎСѓРјРјР° РґРѕР»Р¶РЅР° Р±С‹С‚СЊ С‡РёСЃР»РѕРј Рё РЅРµ Р±С‹С‚СЊ 0"},{status:400}); const result=await prisma.$transaction(async tx=>{const w=await tx.wallet.findUnique({where:{userId:id}}); if(!w)throw new Error("WALLET"); const before=Number(w.balance),after=Number((before+amount).toFixed(4)); const nw=await tx.wallet.update({where:{id:w.id},data:{balance:after}}); await tx.transaction.create({data:{walletId:w.id,type:amount>0?"DEPOSIT":"WITHDRAW",status:"COMPLETED",amount,balanceBefore:before,balanceAfter:after,description:"РђРґРјРёРЅРёСЃС‚СЂР°С‚РёРІРЅР°СЏ РєРѕСЂСЂРµРєС‚РёСЂРѕРІРєР° Р±Р°Р»Р°РЅСЃР°"}}); return nw}); await audit(me.id,"WALLET_ADJUST","USER",id,{amount}); return NextResponse.json({ok:true,balance:result.balance.toString()});
    }
    if(action==="cancelMatch"){
      const id=String(body.matchId); const match=await prisma.match.findUnique({where:{id}}); if(!match)return NextResponse.json({error:"РњР°С‚С‡ РЅРµ РЅР°Р№РґРµРЅ"},{status:404}); if(!["WAITING_FOR_PLAYERS","READY"].includes(match.status) && !(match.status==="LIVE" && !(match.serverConfig as any)?.connectUrl))return NextResponse.json({error:"РњР°С‚С‡ СѓР¶Рµ Р·Р°РїСѓС‰РµРЅ РёР»Рё Р·Р°РІРµСЂС€С‘РЅ"},{status:409}); const amount=Number(match.betAmount); await prisma.$transaction(async tx=>{for(const uid of [match.playerOneId,match.playerTwoId].filter(Boolean) as string[]){const w=await tx.wallet.findUnique({where:{userId:uid}}); if(w){const before=Number(w.balance),after=before+amount; await tx.wallet.update({where:{id:w.id},data:{balance:after,lockedBalance:{decrement:amount}}}); await tx.transaction.create({data:{walletId:w.id,type:"REFUND",status:"COMPLETED",amount,balanceBefore:before,balanceAfter:after,referenceId:id,description:"Р’РѕР·РІСЂР°С‚ СЃС‚Р°РІРєРё Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂРѕРј"}})}} await tx.match.update({where:{id},data:{status:"CANCELLED",endedAt:new Date()}})}); await audit(me.id,"CANCEL_MATCH","MATCH",id); return NextResponse.json({ok:true});
    }
    return NextResponse.json({error:"РќРµРёР·РІРµСЃС‚РЅРѕРµ РґРµР№СЃС‚РІРёРµ"},{status:400});
  }catch(e){if(e instanceof Error&&e.message==="FORBIDDEN")return NextResponse.json({error:"РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ РїСЂР°РІ"},{status:403}); if(e instanceof Error&&e.message==="WALLET")return NextResponse.json({error:"РљРѕС€РµР»С‘Рє РЅРµ РЅР°Р№РґРµРЅ"},{status:404}); console.error(e);return NextResponse.json({error:"РђРґРјРёРЅРёСЃС‚СЂР°С‚РёРІРЅР°СЏ РѕРїРµСЂР°С†РёСЏ РЅРµ РІС‹РїРѕР»РЅРµРЅР°"},{status:500})}
}

