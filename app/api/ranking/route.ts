import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export async function GET(){try{const users=await prisma.user.findMany({where:{status:"ACTIVE",deletedAt:null},select:{nickname:true,reputation:true,level:true,xp:true,avatarUrl:true},orderBy:[{reputation:"desc"},{level:"desc"},{xp:"desc"}],take:50});return NextResponse.json(users.map(u=>({...u,reputation:Number(u.reputation),level:Number(u.level),xp:Number(u.xp)})))}catch(e){console.error(e);return NextResponse.json({error:"Не удалось загрузить рейтинг"},{status:500})}}
