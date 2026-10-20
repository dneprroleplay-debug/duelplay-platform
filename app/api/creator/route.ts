import { NextRequest,NextResponse } from "next/server"; import { prisma } from "@/lib/prisma"; import { getCurrentUser } from "@/lib/current-user"; import { audit } from "@/lib/admin"; import { requirePermission } from "@/lib/admin-rbac";
function permissionError(e:unknown){if(!(e instanceof Error))return null;if(e.message==="ADMIN_LOGIN_REQUIRED")return NextResponse.json({error:"Unauthorized",errorCode:e.message},{status:401});if(e.message==="FORBIDDEN"||e.message.startsWith("ADMIN_MFA_"))return NextResponse.json({error:"Forbidden",errorCode:e.message},{status:403});return null;}
export async function GET(){const me=await getCurrentUser();if(!me)return NextResponse.json({error:"Unauthorized"},{status:401});const profile=await prisma.creatorProfile.findUnique({where:{userId:me.id},include:{payouts:{orderBy:{createdAt:"desc"}}}});return NextResponse.json(profile)}
export async function POST(r:NextRequest){const me=await getCurrentUser();if(!me)return NextResponse.json({error:"Unauthorized"},{status:401});const b=await r.json();if(String(b.action||"")==="requestPayout"){const profile=await prisma.creatorProfile.findUnique({where:{userId:me.id}});const amount=Number(b.amount);if(!profile||!Number.isFinite(amount)||amount<=0)return NextResponse.json({error:"Invalid payout"},{status:400});
    let result;
    try { result=await prisma.$transaction(async tx=>{
      const earned=await tx.transaction.aggregate({where:{type:"REFERRAL",status:"COMPLETED",wallet:{userId:me.id},referenceId:{not:null},createdAt:{gte:profile.createdAt}},_sum:{amount:true}});
      const totalEarned=Number(earned._sum.amount||0);
      const alreadyPaid=Number((await tx.creatorPayout.aggregate({where:{creatorId:profile.id,status:{in:["PENDING","APPROVED","PAID"]}},_sum:{amount:true}}))._sum.amount||0);
      const available=Number(Math.max(0,totalEarned-alreadyPaid).toFixed(4));
      if(amount>available)throw new Error(`PAYOUT_EXCEEDS:${available}`);
      const payout=await tx.creatorPayout.create({data:{creatorId:profile.id,userId:me.id,amount,status:"PENDING"}});
      return {payout,available};
    });
    return NextResponse.json({...result.payout,availableAfter:Number((result.available-amount).toFixed(4))},{status:201});
    } catch(e) { if(e instanceof Error&&e.message.startsWith("PAYOUT_EXCEEDS:")) return NextResponse.json({error:"Payout exceeds available creator earnings",available:Number(e.message.split(":")[1])},{status:409}); throw e; }
  }let access:Awaited<ReturnType<typeof requirePermission>>;try{access=await requirePermission("creator.payouts.manage");}catch(e){const r=permissionError(e);if(r)return r;throw e;}const admin=access.user;const userId=String(b.userId||"");const displayName=String(b.displayName||"").trim().slice(0,80);const bio=b.bio?String(b.bio).trim().slice(0,1000):null;const commissionRate=Number(b.commissionRate??20);if(!userId||!displayName||!Number.isFinite(commissionRate)||commissionRate<0||commissionRate>100)return NextResponse.json({error:"Invalid creator profile"},{status:400});const profile=await prisma.creatorProfile.upsert({where:{userId},update:{displayName,bio,commissionRate},create:{userId,displayName,bio,referralCode:`CR-${userId.slice(0,8).toUpperCase()}`,commissionRate}});await audit(admin.id,"UPSERT_CREATOR_PROFILE","CREATOR_PROFILE",profile.id,{userId,displayName,commissionRate});return NextResponse.json(profile)}
