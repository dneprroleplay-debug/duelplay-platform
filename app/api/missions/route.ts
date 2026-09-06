import {NextRequest,NextResponse} from "next/server";
import {prisma} from "@/lib/prisma";
import {getCurrentUser} from "@/lib/current-user";
import {grantReward} from "@/lib/rewards";
export async function GET(){
 const me=await getCurrentUser();if(!me)return NextResponse.json({error:"Unauthorized"},{status:401});const now=new Date();
 const missions=await prisma.mission.findMany({where:{active:true,OR:[{startsAt:null},{startsAt:{lte:now}}],AND:[{OR:[{endsAt:null},{endsAt:{gte:now}}]}]}});
 const stats=await prisma.playerStats.findUnique({where:{userId:me.id}});const cases=await prisma.caseOpening.count({where:{userId:me.id,createdAt:{gte:new Date(Date.now()-86400000)}}});
 for(const m of missions){let progress=0;if(m.type==="PLAY_DUELS")progress=stats?.totalDuels??0;else if(m.type==="WINS")progress=stats?.wins??0;else if(m.type==="STREAK")progress=stats?.bestStreak??0;else if(m.type==="OPEN_CASE")progress=cases;progress=Math.min(progress,m.target);await prisma.userMission.upsert({where:{userId_missionId:{userId:me.id,missionId:m.id}},update:{progress,status:progress>=m.target?"COMPLETED":"ACTIVE",completedAt:progress>=m.target?new Date():undefined},create:{userId:me.id,missionId:m.id,progress,status:progress>=m.target?"COMPLETED":"ACTIVE",completedAt:progress>=m.target?new Date():undefined}})}
 return NextResponse.json(await prisma.userMission.findMany({where:{userId:me.id},include:{mission:true}}));
}
export async function POST(r:NextRequest){
 const me=await getCurrentUser();if(!me)return NextResponse.json({error:"Unauthorized"},{status:401});const{missionId}=await r.json();
 try{return NextResponse.json(await prisma.$transaction(async tx=>{const row=await tx.userMission.findUnique({where:{userId_missionId:{userId:me.id,missionId:String(missionId)}},include:{mission:true}});if(!row||row.status!=="COMPLETED")throw new Error("NOT_READY");const claimed=await tx.userMission.updateMany({where:{id:row.id,status:"COMPLETED",claimedAt:null},data:{status:"CLAIMED",claimedAt:new Date()}});if(claimed.count!==1)throw new Error("CLAIMED");const reward=(row.mission.reward||{}) as any;await grantReward(tx,me.id,reward,`mission-reward:${row.id}`,`Mission reward · ${row.mission.name}`,row.missionId);return tx.userMission.findUnique({where:{id:row.id}});}),{status:200});}catch(e){const c=e instanceof Error?e.message:"";return NextResponse.json({error:c==="CLAIMED"?"Mission reward already claimed":c==="NOT_READY"?"Mission not completed":"Could not claim mission"},{status:409});}
}
