import {NextResponse} from "next/server";
import {prisma} from "@/lib/prisma";
import {getCurrentUser} from "@/lib/current-user";
import {PROFILE_COMPLETION_REWARD_KEY} from "@/lib/profile-completion";

export async function GET(){
 const base=await prisma.avatarPreset.findMany({where:{active:true},orderBy:[{sortOrder:"asc"},{createdAt:"desc"}],take:40,select:{id:true,name:true,imageData:true}});
 const user=await getCurrentUser();
 if(!user) return NextResponse.json({presets:base});
 const reward=await prisma.rewardGrant.findUnique({where:{idempotencyKey:`${PROFILE_COMPLETION_REWARD_KEY}:${user.id}`},select:{id:true}});
 const presets=reward?[...base,{id:"profile-complete-reward",name:"DuelPlay Complete",imageData:"/avatars/rewards/profile-complete.svg"}]:base;
 return NextResponse.json({presets});
}
