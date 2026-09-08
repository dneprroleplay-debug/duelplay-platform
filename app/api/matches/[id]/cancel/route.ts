import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { creditWallet } from "@/lib/wallet";
import { lockMatchForUpdate } from "@/lib/match-lifecycle";
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(); if (!user) return NextResponse.json({ error: "Войдите в аккаунт" }, { status: 401 });
    const { id } = await params;
    const result = await prisma.$transaction(async tx => {
      const locked = await lockMatchForUpdate(tx, id);
      if (!locked) throw new Error("NOT_FOUND");
      const match = await tx.match.findUnique({ where: { id }, include: { gameServer: true } });
      if (!match) throw new Error("NOT_FOUND");
      if (match.playerOneId !== user.id) throw new Error("FORBIDDEN");
      if (match.gameServer) throw new Error("SERVER_BUSY");
      if (match.status !== "WAITING_FOR_PLAYERS") throw new Error("INVALID");
      const claim = await tx.match.updateMany({where:{id,status:"WAITING_FOR_PLAYERS"},data:{status:"CANCELLED",endedAt:new Date(),startDeadlineAt:null,connectionDeadlineAt:null}});
      if(claim.count!==1) throw new Error("INVALID");
      const amount = Number(match.betAmount);
      const wallets = [match.playerOneId, match.playerTwoId].filter(Boolean) as string[];
      for (const userId of [...new Set(wallets)]) {
        const wallet = await tx.wallet.findUnique({ where: { userId } }); if (!wallet) throw new Error("WALLET");
        if (Number(wallet.lockedBalance) < amount) throw new Error("LOCKED_STAKE");
        const idem = `refund:${match.id}:${userId}`;
        const existingRefund = await tx.transaction.findUnique({ where: { idempotencyKey: idem } });
        if (!existingRefund) {
          const credited = await creditWallet(tx,userId,amount,idem,"REFUND","Возврат ставки при отмене матча",match.id);
          if (!credited.idempotent) await tx.wallet.update({ where: { id: wallet.id }, data: { lockedBalance: { decrement: amount } } });
        }
      }
      await tx.notification.createMany({data:[...new Set([match.playerOneId,match.playerTwoId].filter(Boolean) as string[])].map(userId=>({userId,type:"CANCELLATION",title:"Match cancelled",body:"Your stake was refunded.",payload:{matchId:id}}))});
      return tx.match.findUniqueOrThrow({where:{id}});
    });
    return NextResponse.json(result);
  } catch (error) { const m=error instanceof Error?error.message:""; if(m==="NOT_FOUND") return NextResponse.json({error:"Матч не найден"},{status:404}); if(m==="FORBIDDEN") return NextResponse.json({error:"Отменить матч может только создатель"},{status:403}); if(m==="SERVER_BUSY") return NextResponse.json({error:"Сервер уже запускается для этой дуэли"},{status:409}); if(m==="LOCKED_STAKE") return NextResponse.json({error:"Заблокированная ставка матча повреждена"},{status:409}); if(m==="INVALID") return NextResponse.json({error:"Этот матч уже нельзя отменить"},{status:409}); console.error(error); return NextResponse.json({error:"Не удалось отменить матч"},{status:500}); }
}
