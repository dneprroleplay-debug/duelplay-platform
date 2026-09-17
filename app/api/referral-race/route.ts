import {NextResponse} from "next/server";
import { getFeatureFlag } from "@/lib/feature-flags";
import {prisma} from "@/lib/prisma";
import {requireAdmin,audit} from "@/lib/admin";
import {creditWallet} from "@/lib/wallet";
import {REFERRAL_RACE_PRIZES, referralRaceMonthKey, referralRaceWindow, rankReferralRace} from "@/lib/referral-race";

const PRIZES=REFERRAL_RACE_PRIZES;

function monthWindow(monthKey?:string){
  const key=monthKey || referralRaceMonthKey();
  const {month,next}=referralRaceWindow(key);
  return {month,next,key};
}

async function leaderboard(month:Date,next:Date){
  const users=await prisma.user.findMany({
    where:{status:"ACTIVE",deletedAt:null,referrals:{some:{createdAt:{gte:month,lt:next},status:"ACTIVE",deletedAt:null}}},
    select:{id:true,nickname:true,avatarUrl:true,referralCode:true,referrals:{where:{createdAt:{gte:month,lt:next},status:"ACTIVE",deletedAt:null},select:{id:true}}}
  });
  return rankReferralRace(users.map(u=>({id:u.id,nickname:u.nickname,avatarUrl:u.avatarUrl,code:u.referralCode,invited:u.referrals.length})));
}

export async function GET(request:Request){
  if (!(await getFeatureFlag("REFERRALS", false))) return NextResponse.json({ error: "Referral Race is temporarily disabled", errorCode: "FEATURE_DISABLED" }, { status: 503 });
  try{
    const url=new URL(request.url);
    const {month,next,key}=monthWindow(url.searchParams.get("month")||undefined);
    const rows=await leaderboard(month,next);
    const settlement=await prisma.referralRaceSettlement.findUnique({where:{month:key},select:{settledAt:true,snapshot:true}});
    return NextResponse.json({month:key,prizes:[...PRIZES],settled:!!settlement,settledAt:settlement?.settledAt??null,leaderboard:rows});
  }catch(error){
    const message=error instanceof Error?error.message:"";
    return NextResponse.json({error:message==="INVALID_MONTH"?"Invalid month":"Referral Race failed"},{status:400});
  }
}

export async function POST(request:Request){
  if (!(await getFeatureFlag("REFERRALS", false))) return NextResponse.json({ error: "Referral Race is temporarily disabled", errorCode: "FEATURE_DISABLED" }, { status: 503 });
  try{
    const me=await requireAdmin(5);
    const body=await request.json().catch(()=>({}));
    if(String(body.action||"")!=="settle")return NextResponse.json({error:"Invalid action"},{status:400});
    const {month,next,key}=monthWindow(String(body.month||""));
    const current=monthWindow();
    if(month>=current.month)return NextResponse.json({error:"Only closed months can be settled"},{status:400});
    const rows=await leaderboard(month,next);
    const paid=await prisma.$transaction(async tx=>{
      const existing=await tx.referralRaceSettlement.findUnique({where:{month:key}});
      if(existing)return [];
      const winners=rows.filter(row=>row.prize>0);
      await tx.referralRaceSettlement.create({data:{month:key,settledById:me.id,snapshot:winners as any}});
      const results:any[]=[];
      for(const row of winners){
        const idem=`referral-race:${key}:${row.position}:${row.id}`;
        const reward=await creditWallet(tx,row.id,row.prize,idem,"REFERRAL_RACE_PRIZE",`Referral Race prize #${row.position}`,`referral-race:${key}`);
        if(!reward.idempotent)await tx.notification.create({data:{userId:row.id,type:"TRANSACTION_SUCCESS",status:"UNREAD",title:"Referral Race prize",body:`You received $${row.prize.toFixed(2)} for Referral Race #${row.position}.`,payload:{month:key,position:row.position,amount:row.prize}}});
        results.push({position:row.position,userId:row.id,amount:row.prize,idempotent:reward.idempotent});
      }
      return results;
    },{isolationLevel:"Serializable"});
    await audit(me.id,"SETTLE_REFERRAL_RACE","REFERRAL_RACE",key,{paid});
    return NextResponse.json({ok:true,month:key,paid,alreadySettled:paid.length===0});
  }catch(error){
    console.error(error);
    const message=error instanceof Error?error.message:"";
    const status=message==="FORBIDDEN"?403:message==="INVALID_MONTH"?400:500;
    return NextResponse.json({error:status===403?"Forbidden":status===400?"Invalid month":"Referral Race settlement failed"},{status});
  }
}
