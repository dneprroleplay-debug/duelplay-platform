import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { debitWallet } from "@/lib/wallet";
import { lockMatchForUpdate } from "@/lib/match-lifecycle";
import { deadlineFromNow, MATCH_START_TIMEOUT_MS } from "@/lib/match-timers";
import { assertAccountCanPlay } from "@/lib/anti-fraud";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Войдите, чтобы присоединиться", errorCode: "AUTH_REQUIRED" }, { status: 401 });
    const { id } = await params; const body = await request.json().catch(()=>({})); const idempotencyKey=String(request.headers.get("idempotency-key")||body.idempotencyKey||`join:${id}:${user.id}`);
    const updated = await prisma.$transaction(async (tx) => {
      await assertAccountCanPlay(tx,user.id);
      const existing=await tx.transaction.findUnique({where:{idempotencyKey}});if(existing)return tx.match.findUniqueOrThrow({where:{id}});
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id}::uuid FOR UPDATE`;
      const busy=await tx.match.findFirst({where:{status:{in:["WAITING_FOR_PLAYERS","READY","STARTING","LIVE"]},OR:[{playerOneId:user.id},{playerTwoId:user.id}]},select:{id:true,status:true}});
      if(busy) throw new Error("PLAYER_BUSY");
      const locked = await lockMatchForUpdate(tx, id);
      if (!locked) throw new Error("NOT_FOUND");
      const match = await tx.match.findUnique({ where: { id } });
      if (!match) throw new Error("NOT_FOUND");
      if (match.playerOneId === user.id) throw new Error("OWN_MATCH");
      if (match.playerTwoId || match.status !== "WAITING_FOR_PLAYERS") throw new Error("FULL");
      const amount = Number(match.betAmount);
      const debit = await debitWallet(tx,user.id,amount,idempotencyKey,"MATCH_BET",`Ставка на матч ${match.id.slice(0, 8)}`,match.id);
      const walletRows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Wallet" WHERE "userId" = ${user.id}::uuid FOR UPDATE`;
      const wallet = walletRows[0];
      if (!wallet) throw new Error("INSUFFICIENT_BALANCE");
      await tx.wallet.update({ where: { id: wallet.id }, data: { lockedBalance: { increment: amount } } });
      const ready = await tx.match.update({ where: { id }, data: { playerTwoId: user.id, status: "READY", startDeadlineAt: deadlineFromNow(MATCH_START_TIMEOUT_MS), connectionPhaseCompleted:false } });
      await tx.notification.createMany({data:[{userId:match.playerOneId,type:"MATCH_READY",title:"Match Ready",body:"Both players are ready. Press START to launch the duel.",payload:{matchId:id}},{userId:user.id,type:"MATCH_READY",title:"Match Ready",body:"Both players are ready. Press START to launch the duel.",payload:{matchId:id}}]});
      return ready;
    });
    return NextResponse.json(updated);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    if (msg === "NOT_FOUND") return NextResponse.json({ error: "Матч не найден", errorCode: "MATCH_NOT_FOUND" }, { status: 404 });
    if (msg === "PLAYER_BUSY") return NextResponse.json({ error: "У вас уже есть активная дуэль. Сначала завершите текущую дуэль.", errorCode: "PLAYER_BUSY" }, { status: 409 });
    if (msg === "OWN_MATCH") return NextResponse.json({ error: "Нельзя присоединиться к своему матчу", errorCode: "OWN_MATCH" }, { status: 409 });
    if (msg === "FULL") return NextResponse.json({ error: "Матч уже заполнен", errorCode: "MATCH_FULL" }, { status: 409 });
    if (msg === "INSUFFICIENT_BALANCE") return NextResponse.json({ error: "Недостаточно средств для входа в матч", errorCode: "INSUFFICIENT_BALANCE" }, { status: 400 });
    if (msg === "ACCOUNT_SUSPENDED" || msg === "ACCOUNT_BANNED" || msg === "ACCOUNT_DEACTIVATED") return NextResponse.json({ error: "Аккаунт временно недоступен для игры", errorCode: msg }, { status: 403 });
    console.error(error); return NextResponse.json({ error: "Не удалось присоединиться", errorCode: "JOIN_ERROR" }, { status: 500 });
  }
}
