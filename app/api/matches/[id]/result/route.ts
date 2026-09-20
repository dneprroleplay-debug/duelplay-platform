import { NextResponse } from "next/server";
import { getPlatformNumber } from "@/lib/platform-settings";
import { awardXp, updateMatchProgress, updateRatingAfterDuel, recordMatchStats } from "@/lib/progression";
import { referralMultiplier } from "@/lib/promotions";
import { recalculateTrust } from "@/lib/trust";
import { creditWallet, releaseWalletHold } from "@/lib/wallet";
import { recordPlatformLedgerEntry } from "@/lib/finance";
import { lockMatchForUpdate } from "@/lib/match-lifecycle";
import { evaluateAndUnlockAchievements } from "@/lib/achievements";
import { prisma } from "@/lib/prisma";
import { enforceIpRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-meta";
import { secureSecretEqual } from "@/lib/secure-secret";

function authorized(request: Request) {
  const secret = process.env.CS2_RESULT_SECRET?.trim();
  return secureSecretEqual(request.headers.get("x-cs2-result-secret"), secret);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ip = getClientIp(request);
    await prisma.$transaction(tx => enforceIpRateLimit(tx, ip, "CS2_RESULT_API", 120, 10 * 60_000));
  } catch (error) {
    if (error instanceof Error && error.message === "RATE_LIMITED") return NextResponse.json({ error: "Слишком много запросов результата CS2." }, { status: 429 });
    throw error;
  }
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
      const wallets = await tx.wallet.findMany({ where: { userId: { in: [winnerId, loserId] } }, select: { userId: true } });
      if (wallets.length !== 2) throw new Error("WALLET");

      const stake = Number(match.betAmount);
      await creditWallet(tx, winnerId, payout, resultIdempotency, "MATCH_WIN", `CS2 referee result · $${payout.toFixed(2)}`, match.id);
      await releaseWalletHold(tx, winnerId, stake, `match-stake-release:result:${match.id}:${winnerId}`, "MATCH_STAKE", match.id, "CONSUMED", "CS2 referee result");
      await releaseWalletHold(tx, loserId, stake, `match-stake-release:result:${match.id}:${loserId}`, "MATCH_STAKE", match.id, "CONSUMED", "CS2 referee result");
      await recordPlatformLedgerEntry(tx, { type: "MATCH_COMMISSION", amount: fee, referenceType: "MATCH", referenceId: match.id, description: "Match commission · CS2 referee result" });
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
      return tx.match.update({ where: { id }, data: { winnerId, loserId, status: "FINISHED", endedAt: new Date(), connectionPhaseCompleted: true, connectionDeadlineAt: null, liveDeadlineAt: null, serverConfig: { ...serverCfg, state: "FINISHED", resultSource: "CS2_SERVER" } } });
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
