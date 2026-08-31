import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";

export async function POST(_:Request,{params}:{params:Promise<{id:string}>}){
  const user=await getCurrentUser();
  if(!user)return NextResponse.json({error:"Войдите в аккаунт"},{status:401});
  const{id}=await params;
  const match=await prisma.match.findUnique({where:{id}});
  if(!match)return NextResponse.json({error:"Матч не найден"},{status:404});
  if(![match.playerOneId,match.playerTwoId].includes(user.id))return NextResponse.json({error:"Вы не участник матча"},{status:403});
  if(!match.playerTwoId||match.status!=="READY")return NextResponse.json({error:"Матч не готов к старту"},{status:409});

  const connectUrl=process.env.CS2_SERVER_CONNECT_URL||null;
  const updated=await prisma.match.update({
    where:{id},
    data:{
      status:"LIVE",
      startedAt:new Date(),
      serverConfig:{
        mode:"DEDICATED_CS2",
        status:connectUrl?"READY":"AWAITING_SERVER_CONFIG",
        connectUrl:connectUrl||""
      }
    }
  });
  return NextResponse.json(updated);
}
