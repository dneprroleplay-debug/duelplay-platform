import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPlatformNumber } from "@/lib/platform-settings";
import { awardXp, updateMatchProgress, updateRatingAfterDuel, recordMatchStats } from "@/lib/progression";
import { referralMultiplier } from "@/lib/promotions";
import { recalculateTrust } from "@/lib/trust";
import { creditWallet } from "@/lib/wallet";
import { lockMatchForUpdate } from "@/lib/match-lifecycle";
import { evaluateAndUnlockAchievements } from "@/lib/achievements";

function authorized(request: Request) {
  const secret = process.env.CS2_RESULT_SECRET || process.env.DUELPLAY_SERVER_MANAGER_SECRET;
  return Boolean(secret && request.headers.get("x-cs2-result-secret") === secret);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized referee request" }, { status: 401 });
  try {
    const { id } = await params;
    const body = await request.json();
    const suppliedWinnerId = String(body.winnerId ?? "");
    const suppliedSteamId = String(body.winnerSteamId ?? "");
    if (!suppliedWinnerId && !suppliedSteamId) return NextResponse.json({ error: "winnerId или winnerSteamId обязателен" }, { status: 400 });

    const result = await prisma.$transaction(async tx => {
      const locked = await lockMatchForUpdate(tx, id);
      if (!locked) throw new Error("NOT_FOUND");
      const match = await tx.match.findUnique({ where: { id }, include: { gameServer: true } });
      if (!match) throw new Error("NOT_FOUND");
      if (match.status === "FINISHED") {
        const requestedWinnerId = suppliedWinnerId || (suppliedSteamId
          ? (await tx.user.findUnique({ where: { steamId: suppliedSteamId }, select: { id: true } }))?.id || ""
          : "");
        if (!requestedWinnerId || requestedWinnerId === match.winnerId) return match;
        throw new Error("RESULT_CONFLICT");
      }
      if (match.status !== "LIVE") throw new Error("INVALID_STATUS");
      let winnerId = suppliedWinnerId;
      if (!winnerId && suppliedSteamId) {
        const winnerUser = await tx.user.findUnique({ where: { steamId: suppliedSteamId }, select: { id: true } });
        if (!winnerUser) throw new Error("INVALID_WINNER");
        winnerId = winnerUser.id;
      }
      if (!match.playerTwoId || ![match.playerOneId, match.playerTwoId].includes(winnerId)) throw new Error("INVALID_WINNER");

      const loserId = winnerId === match.playerOneId ? match.playerTwoId : match.playerOneId;
      const pot = Number(match.betAmount) * 2;
      const fee = Number(match.commission);
      const payout = Number((pot - fee).toFixed(4));
      const resultIdempotency = `match-win:${match.id}`;
      const alreadyPaid = await tx.transaction.findUnique({ where: { idempotencyKey: resultIdempotency } });
      if (alreadyPaid) { const finished = await tx.match.findUnique({ where: { id: match.id } }); return finished!; }
      const lockedWallets = await tx.$queryRaw<Array<{ id: string; userId: string; balance: import("@prisma/client").Prisma.Decimal; lockedBalance: import("@prisma/client").Prisma.Decimal }>>`
        SELECT id, "userId", balance, "lockedBalance" FROM "Wallet"
        WHERE "userId" IN (${winnerId}::uuid, ${loserId}::uuid)
        ORDER BY "userId"
        FOR UPDATE
      `;
      const winnerWallet = lockedWallets.find(w => w.userId === winnerId);
      const loserWallet = lockedWallets.find(w => w.userId === loserId);
      if (!winnerWallet || !loserWallet) throw new Error("WALLET");

      const lb = Number(loserWallet.balance);
      const stake = Number(match.betAmount);
      if (Number(winnerWallet.lockedBalance) < stake || Number(loserWallet.lockedBalance) < stake) throw new Error("LOCKED_STAKE");
      await creditWallet(tx, winnerId, payout, resultIdempotency, "MATCH_WIN", `CS2 referee result · $${payout.toFixed(2)}`, match.id);
      await tx.wallet.update({ where: { id: winnerWallet.id }, data: { lockedBalance: { decrement: stake } } });
      await tx.wallet.update({ where: { id: loserWallet.id }, data: { lockedBalance: { decrement: stake } } });
      await tx.transaction.create({ data: { walletId: loserWallet.id, type: "COMMISSION", status: "COMPLETED", amount: 0, balanceBefore: lb, balanceAfter: lb, referenceId: match.id, description: "CS2 referee result · loss" } });
      const referrer = await tx.user.findUnique({where:{id:winnerId},select:{referredById:true}});
      const referralRate = await getPlatformNumber("REFERRAL_COMMISSION",25)/100;
      const referralAmount = Number((fee * referralRate * await referralMultiplier(tx)).toFixed(4));
      if(referrer?.referredById && referralAmount>0){
        const ridem=`referral:${match.id}:${referrer.referredById}`;
        const reward=await creditWallet(tx,referrer.referredById,referralAmount,ridem,"REFERRAL","Referral commission from DuelPlay fee",match.id);
        if(!reward.idempotent){
          await tx.notification.create({data:{userId:referrer.referredById,type:"REFERRAL",title:"Referral reward",body:`You earned $${referralAmount.toFixed(2)} referral commission.`,payload:{matchId:match.id,amount:referralAmount}}});
        }
      }
      await awardXp(tx,winnerId,100);
      await awardXp(tx,loserId,25);
      await updateMatchProgress(tx,winnerId,true);
      await updateMatchProgress(tx,loserId,false);
      await updateRatingAfterDuel(tx,winnerId,loserId);
      const winnerStats=record(body.winnerStats);
      const loserStats=record(body.loserStats);
      await recordMatchStats(tx,match.id,winnerId,winnerStats);
      await recordMatchStats(tx,match.id,loserId,loserStats);
      await tx.user.update({ where: { id: winnerId }, data: { reputation: { increment: 15 } } });
      await tx.user.update({ where: { id: loserId }, data: { reputation: { decrement: 10 } } });
      await recalculateTrust(tx, winnerId);
      await recalculateTrust(tx, loserId);
      const winnerWeapon = typeof winnerStats.weapon === 'string' ? winnerStats.weapon : null;
      await evaluateAndUnlockAchievements(tx, winnerId, { matchId: match.id, won: true, weapon: winnerWeapon });
      await evaluateAndUnlockAchievements(tx, loserId, { matchId: match.id, won: false, weapon: typeof loserStats.weapon === 'string' ? loserStats.weapon : null });
      await tx.notification.create({ data: { userId: winnerId, type: "WIN", title: "Победа в дуэли", body: `Ты победил в CS2 1х1 и получил $${payout.toFixed(2)}.`, payload: { matchId: match.id, payout } } });
      await tx.notification.create({ data: { userId: loserId, type: "LOSS", title: "Матч завершён", body: "Дуэль завершена. Победитель подтверждён игровым сервером.", payload: { matchId: match.id } } });

      const serverCfg = record(match.serverConfig);
      return tx.match.update({ where: { id }, data: { winnerId, loserId, status: "FINISHED", endedAt: new Date(), connectionPhaseCompleted: true, connectionDeadlineAt: null, serverConfig: { ...serverCfg, state: "FINISHED", resultSource: "CS2_SERVER" } } });
    });

    return NextResponse.json({ ok: true, match: result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return NextResponse.json({ error: "Матч не найден" }, { status: 404 });
    if (code === "INVALID_STATUS") return NextResponse.json({ error: "Матч не находится в LIVE" }, { status: 409 });
    if (code === "INVALID_WINNER") return NextResponse.json({ error: "Победитель не является участником матча" }, { status: 400 });
    if (code === "RESULT_CONFLICT") return NextResponse.json({ error: "Матч уже завершён с другим победителем" }, { status: 409 });
    if (code === "WALLET") return NextResponse.json({ error: "Кошелёк игрока не найден" }, { status: 500 });
    if (code === "LOCKED_STAKE") return NextResponse.json({ error: "Заблокированная ставка матча повреждена" }, { status: 409 });
    console.error(error);
    return NextResponse.json({ error: "Не удалось принять результат CS2 referee" }, { status: 500 });
  }
}
