import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { debitWallet, lockWallet } from "@/lib/wallet";
import { lockMatchForUpdate } from "@/lib/match-lifecycle";
import { deadlineFromNow, MATCH_START_TIMEOUT_MS } from "@/lib/match-timers";
import { assertAccountCanPlay } from "@/lib/anti-fraud";
import { enforceRateLimit } from "@/lib/rate-limit";
import { withDemoPolicyTransaction, type DemoPolicyTransactionContext } from "@/lib/demo-policy";
import { assertMatchmakingAvailable } from "@/lib/maintenance";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Войдите, чтобы присоединиться", errorCode: "AUTH_REQUIRED" }, { status: 401 });
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const clientKey = String(request.headers.get("idempotency-key") || body.idempotencyKey || `join:${id}`).trim();
    if (!clientKey || clientKey.length > 200) return NextResponse.json({ error: "Invalid idempotency key", errorCode: "INVALID_IDEMPOTENCY_KEY" }, { status: 400 });
    const idempotencyKey = `match-join:${user.id}:${id}:${clientKey}`;

    const join = async (tx: Prisma.TransactionClient, demoContext?: Pick<DemoPolicyTransactionContext, "demo" | "policy">) => {
      await assertMatchmakingAvailable(tx);
      await assertAccountCanPlay(tx, user.id);
      await enforceRateLimit(tx, user.id, "MATCH_JOIN", 20, 60_000);
      if (demoContext) {
        const existing = await tx.demoTransaction.findUnique({ where: { idempotencyKey } });
        if (existing) {
          if (existing.userId !== user.id || existing.matchId !== id || existing.type !== "MATCH_STAKE") throw new Error("IDEMPOTENCY_CONFLICT");
          const prior = await tx.match.findUniqueOrThrow({ where: { id } });
          if (prior.economyMode === "DEMO" && prior.playerTwoId === user.id) return prior;
        }
        const locked = await lockMatchForUpdate(tx, id);
        if (!locked) throw new Error("NOT_FOUND");
        const racedRetry = await tx.demoTransaction.findUnique({ where: { idempotencyKey } });
        if (racedRetry) {
          if (racedRetry.userId !== user.id || racedRetry.matchId !== id || racedRetry.type !== "MATCH_STAKE") throw new Error("IDEMPOTENCY_CONFLICT");
          const current = await tx.match.findUniqueOrThrow({ where: { id } });
          if (current.economyMode === "DEMO" && current.playerTwoId === user.id) return current;
        }
        const match = await tx.match.findUnique({ where: { id } });
        if (!match) throw new Error("NOT_FOUND");
        if (match.economyMode !== "DEMO") throw new Error("ECONOMY_MISMATCH");
        if (match.playerOneId === user.id) throw new Error("OWN_MATCH");
        if (match.playerTwoId || match.status !== "WAITING_FOR_PLAYERS") throw new Error("FULL");
        await demoContext.policy.assertDemoUserCanCreateOrJoin(user.id, "JOIN");
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id}::uuid FOR UPDATE`;
        const busy = await tx.match.findFirst({ where: { status: { in: ["WAITING_FOR_PLAYERS", "READY", "STARTING", "LIVE"] }, OR: [{ playerOneId: user.id }, { playerTwoId: user.id }] }, select: { id: true } });
        if (busy) throw new Error("PLAYER_BUSY");
        const amount = match.betAmount.toString();
        await demoContext.demo.reserveDemoStake(user.id, match.id, amount, idempotencyKey, `match-stake:${idempotencyKey}`);
        const ready = await tx.match.update({ where: { id }, data: { playerTwoId: user.id, status: "READY", startDeadlineAt: deadlineFromNow(MATCH_START_TIMEOUT_MS), connectionPhaseCompleted: false }, include: { playerOne: { select: { id: true, nickname: true, avatarUrl: true, steamAvatarUrl: true } }, playerTwo: { select: { id: true, nickname: true, avatarUrl: true, steamAvatarUrl: true } } } });
        await tx.notification.createMany({ data: [{ userId: match.playerOneId, type: "MATCH_READY", title: "Match Ready", body: "Both players are ready. Press START to launch the duel.", payload: { matchId: id, economyMode: "DEMO" } }, { userId: user.id, type: "MATCH_READY", title: "Match Ready", body: "Both players are ready. Press START to launch the duel.", payload: { matchId: id, economyMode: "DEMO" } }] });
        return ready;
      }

      const existing = await tx.transaction.findUnique({ where: { idempotencyKey } });
      if (existing) return tx.match.findUniqueOrThrow({ where: { id } });
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id}::uuid FOR UPDATE`;
      const busy = await tx.match.findFirst({ where: { status: { in: ["WAITING_FOR_PLAYERS", "READY", "STARTING", "LIVE"] }, OR: [{ playerOneId: user.id }, { playerTwoId: user.id }] }, select: { id: true } });
      if (busy) throw new Error("PLAYER_BUSY");
      const locked = await lockMatchForUpdate(tx, id);
      if (!locked) throw new Error("NOT_FOUND");
      const match = await tx.match.findUnique({ where: { id } });
      if (!match) throw new Error("NOT_FOUND");
      if (match.economyMode !== "REAL") throw new Error("ECONOMY_MISMATCH");
      if (match.playerOneId === user.id) throw new Error("OWN_MATCH");
      if (match.playerTwoId || match.status !== "WAITING_FOR_PLAYERS") throw new Error("FULL");
      const amount = Number(match.betAmount);
      const debit = await debitWallet(tx, user.id, amount, idempotencyKey, "MATCH_BET", `Ставка на матч ${match.id.slice(0, 8)}`, match.id);
      await lockWallet(tx, user.id, amount, `match-stake:${idempotencyKey}`, "MATCH_STAKE", match.id, `Ставка зарезервирована · ${match.id.slice(0, 8)}`);
      const ready = await tx.match.update({ where: { id }, data: { playerTwoId: user.id, status: "READY", startDeadlineAt: deadlineFromNow(MATCH_START_TIMEOUT_MS), connectionPhaseCompleted: false }, include: { playerOne: { select: { id: true, nickname: true, avatarUrl: true, steamAvatarUrl: true } }, playerTwo: { select: { id: true, nickname: true, avatarUrl: true, steamAvatarUrl: true } } } });
      await tx.notification.createMany({ data: [{ userId: match.playerOneId, type: "MATCH_READY", title: "Match Ready", body: "Both players are ready. Press START to launch the duel.", payload: { matchId: id } }, { userId: user.id, type: "MATCH_READY", title: "Match Ready", body: "Both players are ready. Press START to launch the duel.", payload: { matchId: id } }] });
      return ready;
    };

    const match = await prisma.match.findUnique({ where: { id }, select: { economyMode: true } });
    if (!match) throw new Error("NOT_FOUND");
    const updated = match.economyMode === "DEMO"
      ? await withDemoPolicyTransaction(({ db, ...context }) => join(db, context))
      : await prisma.$transaction(tx => join(tx));
    return NextResponse.json(updated);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    if (msg === "CS2_MAINTENANCE") return NextResponse.json({ error: "Идёт обновление серверов CS2. Пожалуйста, подождите", errorCode: msg }, { status: 503 });
    if (msg === "NOT_FOUND") return NextResponse.json({ error: "Матч не найден", errorCode: "MATCH_NOT_FOUND" }, { status: 404 });
    if (msg === "PLAYER_BUSY") return NextResponse.json({ error: "У вас уже есть активная дуэль. Сначала завершите текущую дуэль.", errorCode: msg }, { status: 409 });
    if (msg === "OWN_MATCH") return NextResponse.json({ error: "Нельзя присоединиться к своему матчу", errorCode: msg }, { status: 409 });
    if (msg === "FULL") return NextResponse.json({ error: "Матч уже заполнен", errorCode: "MATCH_FULL" }, { status: 409 });
    if (msg === "ECONOMY_MISMATCH" || msg === "IDEMPOTENCY_CONFLICT") return NextResponse.json({ error: "Конфликт состояния матча или ключа операции", errorCode: msg }, { status: 409 });
    if (msg === "INSUFFICIENT_DEMO_BALANCE") return NextResponse.json({ error: "Недостаточно виртуальных кредитов DC для ставки", errorCode: msg }, { status: 400 });
    if (msg === "INSUFFICIENT_BALANCE") return NextResponse.json({ error: "Недостаточно средств для входа в матч", errorCode: msg }, { status: 400 });
    if (msg === "DEMO_USER_BLOCKED") return NextResponse.json({ error: "Присоединение к DEMO-матчам для аккаунта отключено", errorCode: msg }, { status: 403 });
    if (["ACCOUNT_SUSPENDED", "ACCOUNT_BANNED", "ACCOUNT_DEACTIVATED"].includes(msg)) return NextResponse.json({ error: "Аккаунт временно недоступен для игры", errorCode: msg }, { status: 403 });
    console.error(error); return NextResponse.json({ error: "Не удалось присоединиться", errorCode: "JOIN_ERROR" }, { status: 500 });
  }
}
