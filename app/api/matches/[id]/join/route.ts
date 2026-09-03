import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Войдите, чтобы присоединиться", errorCode: "AUTH_REQUIRED" }, { status: 401 });
    const { id } = await params;
    const updated = await prisma.$transaction(async (tx) => {
      const match = await tx.match.findUnique({ where: { id } });
      if (!match) throw new Error("NOT_FOUND");
      if (match.playerOneId === user.id) throw new Error("OWN_MATCH");
      if (match.playerTwoId || match.status !== "WAITING_FOR_PLAYERS") throw new Error("FULL");
      const wallet = await tx.wallet.findUnique({ where: { userId: user.id } });
      if (!wallet || Number(wallet.balance) < Number(match.betAmount)) throw new Error("INSUFFICIENT_BALANCE");
      const amount = Number(match.betAmount); const before = wallet.balance; const after = Number(before) - amount;
      await tx.wallet.update({ where: { id: wallet.id }, data: { balance: after, lockedBalance: { increment: amount } } });
      await tx.transaction.create({ data: { walletId: wallet.id, type: "MATCH_BET", status: "COMPLETED", amount: -amount, balanceBefore: before, balanceAfter: after, referenceId: match.id, description: `Ставка на матч ${match.id.slice(0, 8)}` } });
      return tx.match.update({ where: { id }, data: { playerTwoId: user.id, status: "READY" } });
    });
    return NextResponse.json(updated);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    if (msg === "NOT_FOUND") return NextResponse.json({ error: "Матч не найден", errorCode: "MATCH_NOT_FOUND" }, { status: 404 });
    if (msg === "OWN_MATCH") return NextResponse.json({ error: "Нельзя присоединиться к своему матчу", errorCode: "OWN_MATCH" }, { status: 409 });
    if (msg === "FULL") return NextResponse.json({ error: "Матч уже заполнен", errorCode: "MATCH_FULL" }, { status: 409 });
    if (msg === "INSUFFICIENT_BALANCE") return NextResponse.json({ error: "Недостаточно средств для входа в матч", errorCode: "INSUFFICIENT_BALANCE" }, { status: 400 });
    console.error(error); return NextResponse.json({ error: "Не удалось присоединиться", errorCode: "JOIN_ERROR" }, { status: 500 });
  }
}
