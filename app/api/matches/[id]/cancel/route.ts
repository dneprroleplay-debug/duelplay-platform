import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser(); if (!user) return NextResponse.json({ error: "Войдите в аккаунт" }, { status: 401 });
    const { id } = await params;
    const result = await prisma.$transaction(async tx => {
      const match = await tx.match.findUnique({ where: { id } });
      if (!match) throw new Error("NOT_FOUND");
      if (match.playerOneId !== user.id) throw new Error("FORBIDDEN");
      if (!["WAITING_FOR_PLAYERS", "READY"].includes(match.status) && !(match.status==="LIVE" && !(match.serverConfig as any)?.connectUrl)) throw new Error("INVALID");
      const amount = Number(match.betAmount);
      const wallet = await tx.wallet.findUnique({ where: { userId: user.id } }); if (!wallet) throw new Error("WALLET");
      const before = wallet.balance; const after = Number(before) + amount;
      await tx.wallet.update({ where: { id: wallet.id }, data: { balance: after, lockedBalance: { decrement: amount } } });
      await tx.transaction.create({ data: { walletId: wallet.id, type: "REFUND", status: "COMPLETED", amount, balanceBefore: before, balanceAfter: after, referenceId: match.id, description: "Возврат ставки при отмене матча" } });
      if (match.playerTwoId) {
        const opponent = await tx.wallet.findUnique({ where: { userId: match.playerTwoId } });
        if (opponent) { const ob = opponent.balance; const oa = Number(ob) + amount; await tx.wallet.update({ where: { id: opponent.id }, data: { balance: oa, lockedBalance: { decrement: amount } } }); await tx.transaction.create({ data: { walletId: opponent.id, type: "REFUND", status: "COMPLETED", amount, balanceBefore: ob, balanceAfter: oa, referenceId: match.id, description: "Возврат ставки при отмене матча" } }); }
      }
      return tx.match.update({ where: { id }, data: { status: "CANCELLED", endedAt: new Date() } });
    });
    return NextResponse.json(result);
  } catch (error) { const m=error instanceof Error?error.message:""; if(m==="NOT_FOUND") return NextResponse.json({error:"Матч не найден"},{status:404}); if(m==="FORBIDDEN") return NextResponse.json({error:"Отменить матч может только создатель"},{status:403}); if(m==="INVALID") return NextResponse.json({error:"Этот матч уже нельзя отменить"},{status:409}); console.error(error); return NextResponse.json({error:"Не удалось отменить матч"},{status:500}); }
}
