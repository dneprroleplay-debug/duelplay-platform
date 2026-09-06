import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { awardXp, updateMatchProgress, updateRatingAfterDuel, recordMatchStats } from "@/lib/progression";
import { creditWallet } from "@/lib/wallet";
import { recalculateTrust } from "@/lib/trust";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.NODE_ENV === "production" || process.env.DUELPLAY_LOCAL_TEST_MODE === "false") {
    return NextResponse.json({ error: "Local test mode is disabled" }, { status: 404 });
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Войдите в аккаунт", errorCode: "AUTH_REQUIRED" }, { status: 401 });
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const winnerId = String(body.winnerId ?? "");
    const result = await prisma.$transaction(async tx => {
      const match = await tx.match.findUnique({
        where: { id },
        include: {
          playerOne: { select: { id: true, nickname: true, isTestAccount: true } },
          playerTwo: { select: { id: true, nickname: true, isTestAccount: true } },
          gameServer: true,
        },
      });
      if (!match) throw new Error("NOT_FOUND");
      const cfg = record(match.serverConfig);
      if (cfg.localTest !== true) throw new Error("NOT_LOCAL_TEST");
      if (match.playerOne.isTestAccount !== true || match.playerTwo?.isTestAccount !== true) throw new Error("TEST_ONLY");
      if (![match.playerOneId, match.playerTwoId].includes(user.id)) throw new Error("FORBIDDEN");
      if (match.status !== "LIVE") throw new Error("INVALID_STATUS");
      if (!match.playerTwoId || ![match.playerOneId, match.playerTwoId].includes(winnerId)) throw new Error("INVALID_WINNER");

      const loserId = winnerId === match.playerOneId ? match.playerTwoId : match.playerOneId;
      const claim=await tx.match.updateMany({where:{id,status:"LIVE"},data:{winnerId,loserId,status:"FINISHED",endedAt:new Date(),connectionPhaseCompleted:true,connectionDeadlineAt:null}});
      if(claim.count!==1)throw new Error("INVALID_STATUS");
      const amount = Number(match.betAmount);
      const pot = amount * 2;
      const fee = Number(match.commission);
      const payout = Number((pot - fee).toFixed(4));
      const lockedWallets = await tx.$queryRaw<Array<{ id: string; userId: string; balance: import("@prisma/client").Prisma.Decimal; lockedBalance: import("@prisma/client").Prisma.Decimal }>>`
        SELECT id, "userId", balance, "lockedBalance" FROM "Wallet"
        WHERE "userId" IN (${winnerId}, ${loserId}) ORDER BY "userId" FOR UPDATE
      `;
      const winnerWallet = lockedWallets.find(w => w.userId === winnerId);
      const loserWallet = lockedWallets.find(w => w.userId === loserId);
      if (!winnerWallet || !loserWallet) throw new Error("WALLET");
      if (Number(winnerWallet.lockedBalance) < amount || Number(loserWallet.lockedBalance) < amount) throw new Error("LOCKED_STAKE");
      const winKey = `local-test:${match.id}:win`;
      const reward = await creditWallet(tx, winnerId, payout, winKey, "MATCH_WIN", `LOCAL TEST · победа · $${payout.toFixed(2)}`, match.id);
      await tx.wallet.update({ where: { id: winnerWallet.id }, data: { lockedBalance: { decrement: amount } } });
      await tx.wallet.update({ where: { id: loserWallet.id }, data: { lockedBalance: { decrement: amount } } });
      if (!reward.idempotent) await tx.transaction.create({ data: { walletId: loserWallet.id, type: "COMMISSION", status: "COMPLETED", amount: 0, balanceBefore: Number(loserWallet.balance), balanceAfter: Number(loserWallet.balance), referenceId: match.id, description: "LOCAL TEST · loss" } });
      await tx.user.update({ where: { id: winnerId }, data: { reputation: { increment: 15 } } });
      await tx.user.update({ where: { id: loserId }, data: { reputation: { decrement: 10 } } });
      await recalculateTrust(tx, winnerId);
      await recalculateTrust(tx, loserId);
      await awardXp(tx,winnerId,100);
      await awardXp(tx,loserId,25);
      await updateMatchProgress(tx,winnerId,true);
      await updateMatchProgress(tx,loserId,false);
      await updateRatingAfterDuel(tx,winnerId,loserId);
      const winnerStats = record(body.winnerStats);
      const loserStats = record(body.loserStats);
      await recordMatchStats(tx,match.id,winnerId,winnerStats);
      await recordMatchStats(tx,match.id,loserId,loserStats);
      await tx.notification.create({ data: { userId: winnerId, type: "WIN", title: "Победа в тестовой дуэли", body: `Тестовый матч завершён. Начислено $${payout.toFixed(2)}.`, payload: { matchId: match.id, payout, localTest: true } } });
      await tx.notification.create({ data: { userId: loserId, type: "LOSS", title: "Тестовый матч завершён", body: "Победитель выбран в локальном тестовом режиме.", payload: { matchId: match.id, localTest: true } } });
      return tx.match.update({
        where: { id },
        data: { winnerId, loserId, status: "FINISHED", endedAt: new Date(), serverConfig: { ...cfg, state: "FINISHED", resultSource: "LOCAL_TEST" } },
        include: { winner: { select: { id: true, nickname: true, avatarUrl: true } } },
      });
    });
    return NextResponse.json({ ok: true, match: result, localTest: true });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const errors: Record<string, [string, number]> = {
      NOT_FOUND: ["Матч не найден", 404],
      NOT_LOCAL_TEST: ["Локальный тестовый режим для этого матча недоступен", 409],
      TEST_ONLY: ["Локальный тест доступен только двум тестовым аккаунтам", 403],
      FORBIDDEN: ["Вы не участник матча", 403],
      INVALID_STATUS: ["Матч уже завершён или ещё не запущен", 409],
      INVALID_WINNER: ["Победитель должен быть участником матча", 400],
      WALLET: ["Кошелёк игрока не найден", 500],
      LOCKED_STAKE: ["Заблокированная ставка матча повреждена", 409],
    };
    const [message, status] = errors[code] ?? ["Не удалось завершить локальный тест", 500];
    if (status === 500) console.error(error);
    return NextResponse.json({ error: message, errorCode: code || "LOCAL_TEST_ERROR" }, { status });
  }
}
