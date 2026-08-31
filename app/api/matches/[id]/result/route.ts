import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function authorized(request:Request){
  const secret=process.env.CS2_RESULT_SECRET;
  return Boolean(secret&&request.headers.get("x-cs2-result-secret")===secret);
}

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  if(!authorized(request))return NextResponse.json({error:"Unauthorized referee request"},{status:401});
  try{
    const {id}=await params;
    const body=await request.json();
    const suppliedWinnerId=String(body.winnerId??"");
    const suppliedSteamId=String(body.winnerSteamId??"");
    if(!suppliedWinnerId&&!suppliedSteamId)return NextResponse.json({error:"winnerId или winnerSteamId обязателен"},{status:400});

    const result=await prisma.$transaction(async tx=>{
      const match=await tx.match.findUnique({where:{id}});
      if(!match)throw new Error("NOT_FOUND");
      if(match.status!=="LIVE")throw new Error("INVALID_STATUS");
      let winnerId=suppliedWinnerId;
      if(!winnerId&&suppliedSteamId){
        const winnerUser=await tx.user.findUnique({where:{steamId:suppliedSteamId},select:{id:true}});
        if(!winnerUser)throw new Error("INVALID_WINNER");
        winnerId=winnerUser.id;
      }
      if(!match.playerTwoId||![match.playerOneId,match.playerTwoId].includes(winnerId))throw new Error("INVALID_WINNER");

      const loserId=winnerId===match.playerOneId?match.playerTwoId:match.playerOneId;
      const pot=Number(match.betAmount)*2;
      const fee=Number(match.commission);
      const payout=Number((pot-fee).toFixed(4));

      const winnerWallet=await tx.wallet.findUnique({where:{userId:winnerId}});
      const loserWallet=await tx.wallet.findUnique({where:{userId:loserId}});
      if(!winnerWallet||!loserWallet)throw new Error("WALLET");

      const wb=Number(winnerWallet.balance);
      const lb=Number(loserWallet.balance);
      await tx.wallet.update({where:{id:winnerWallet.id},data:{balance:wb+payout,lockedBalance:{decrement:Number(match.betAmount)}}});
      await tx.wallet.update({where:{id:loserWallet.id},data:{lockedBalance:{decrement:Number(match.betAmount)}}});

      await tx.transaction.create({data:{
        walletId:winnerWallet.id,type:"MATCH_WIN",status:"COMPLETED",amount:payout,
        balanceBefore:wb,balanceAfter:wb+payout,referenceId:match.id,
        description:`CS2 referee result · $${payout.toFixed(2)}`
      }});
      await tx.transaction.create({data:{
        walletId:loserWallet.id,type:"COMMISSION",status:"COMPLETED",amount:0,
        balanceBefore:lb,balanceAfter:lb,referenceId:match.id,
        description:"CS2 referee result · loss"
      }});

      await tx.user.update({where:{id:winnerId},data:{xp:{increment:100},level:{increment:1},reputation:{increment:15}}});
      await tx.user.update({where:{id:loserId},data:{xp:{increment:25},reputation:{decrement:10}}});

      return tx.match.update({where:{id},data:{winnerId,loserId,status:"FINISHED",endedAt:new Date()}});
    });

    return NextResponse.json({ok:true,match:result});
  }catch(error){
    const code=error instanceof Error?error.message:"";
    if(code==="NOT_FOUND")return NextResponse.json({error:"Матч не найден"},{status:404});
    if(code==="INVALID_STATUS")return NextResponse.json({error:"Матч не находится в LIVE"},{status:409});
    if(code==="INVALID_WINNER")return NextResponse.json({error:"Победитель не является участником матча"},{status:400});
    if(code==="WALLET")return NextResponse.json({error:"Кошелёк игрока не найден"},{status:500});
    console.error(error);
    return NextResponse.json({error:"Не удалось принять результат CS2 referee"},{status:500});
  }
}
