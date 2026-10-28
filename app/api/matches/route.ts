import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getPlatformNumber, getFeatureFlag } from "@/lib/platform-settings";
import { formatMatchAmount } from "@/lib/match-currency";
import { getCurrentUser } from "@/lib/current-user";
import { debitWallet, lockWallet } from "@/lib/wallet";
import { assertAccountCanPlay, assessUserRisk, recordFraudSignal } from "@/lib/anti-fraud";
import { isDuelMode, normalizeModeWeaponModifier, type DuelModeId } from "@/lib/duel-modes";
import { getDuelMap } from "@/lib/duel-maps";
import { withDemoPolicyTransaction, type DemoPolicyTransactionContext } from "@/lib/demo-policy";
import { assertMatchmakingAvailable } from "@/lib/maintenance";
import { buildMatchModeConfigSnapshot, getActiveGameModeConfig } from "@/lib/game-mode-config-store";
import { Prisma } from "@prisma/client";

const COMMISSION_RATE = .10, MIN_BET = 3, MAX_BET = 10000;

const HISTORY_STATUS_FILTERS: Record<string, Prisma.MatchWhereInput["status"]> = {
  all: { in: ["FINISHED", "CANCELLED", "DISPUTED"] },
  finished: "FINISHED",
  cancelled: "CANCELLED",
  disputed: "DISPUTED",
};

export async function GET(request: NextRequest) {
  try {
    if (request.nextUrl.searchParams.get("recent") === "1") {
      const recent = await prisma.match.findMany({
        where: {
          economyMode: "REAL",
          status: { in: ["WAITING_FOR_PLAYERS", "READY", "STARTING", "LIVE", "FINISHED", "CANCELLED", "DISPUTED"] },
          playerOneId: { not: null },
        },
        select: {
          id: true, status: true, mode: true, mapName: true, betAmount: true, createdAt: true,
          playerOne: { select: { id: true, nickname: true, avatarUrl: true } },
          playerTwo: { select: { id: true, nickname: true, avatarUrl: true } },
          winner: { select: { id: true, nickname: true } },
          game: { select: { title: true, slug: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 5,
      });
      return NextResponse.json(recent, { headers: { "Cache-Control": "no-store" } });
    }
    const user = await getCurrentUser();
    const mineParam = request.nextUrl.searchParams.get("mine");
    const mine = mineParam === "active";
    const history = mineParam === "history";
    const status = request.nextUrl.searchParams.get("status");
    const economyParam = request.nextUrl.searchParams.get("economyMode");
    const requestedEconomyMode = economyParam ?? "REAL";
    if (requestedEconomyMode !== "REAL" && requestedEconomyMode !== "DEMO" && requestedEconomyMode !== "ALL") return NextResponse.json({ error: "Invalid economy mode", errorCode: "INVALID_ECONOMY_MODE" }, { status: 400 });
    const economyMode = requestedEconomyMode === "ALL" ? null : requestedEconomyMode;
    const economyFilter: Prisma.MatchWhereInput = economyMode ? { economyMode } : {};
    if (mine) {
      // A player's own active duel must stay reachable regardless of which
      // economy tab is open. Omitting `economyMode` (or passing `ALL`) returns
      // the single active match in either economy so the lobby can always offer
      // a way back into it; an explicit REAL/DEMO filter is still honored.
      const mineEconomyFilter: Prisma.MatchWhereInput = !economyParam || requestedEconomyMode === "ALL" ? {} : economyFilter;
      if (!user) return NextResponse.json({ active: false, match: null });
      const match = await prisma.match.findFirst({ where: { ...mineEconomyFilter, status: { in: ["WAITING_FOR_PLAYERS", "READY", "STARTING", "LIVE"] }, OR: [{ playerOneId: user.id }, { playerTwoId: user.id }] }, select: { id: true, status: true, economyMode: true, mapName: true, mode: true, weaponModifier: true, betAmount: true, playerOneId: true, playerTwoId: true, startedAt: true, startDeadlineAt: true, liveDeadlineAt: true, connectionPhaseCompleted: true }, orderBy: { createdAt: "desc" } });
      return NextResponse.json({ active: Boolean(match), match });
    }
    if (history) {
      if (!user) return NextResponse.json({ matches: [], nextCursor: null, hasMore: false });
      const historyFilter = HISTORY_STATUS_FILTERS[(request.nextUrl.searchParams.get("status") || "all").toLowerCase()] || HISTORY_STATUS_FILTERS.all;
      const limitParam = Number(request.nextUrl.searchParams.get("limit"));
      const limit = Number.isInteger(limitParam) && limitParam > 0 ? Math.min(limitParam, 50) : 20;
      const cursorId = request.nextUrl.searchParams.get("cursor");
      let cursorCreatedAt: Date | undefined;
      if (cursorId) {
        const cursor = await prisma.match.findFirst({ where: { id: cursorId, OR: [{ playerOneId: user.id }, { playerTwoId: user.id }] }, select: { createdAt: true } });
        if (!cursor) return NextResponse.json({ error: "Invalid history cursor", errorCode: "INVALID_CURSOR" }, { status: 400 });
        cursorCreatedAt = cursor.createdAt;
      }
      const rows = await prisma.match.findMany({
        where: {
          ...economyFilter,
          OR: [{ playerOneId: user.id }, { playerTwoId: user.id }],
          status: historyFilter,
          ...(cursorCreatedAt ? { createdAt: { lt: cursorCreatedAt } } : {}),
        },
        include: { playerOne: { select: { id: true, nickname: true, avatarUrl: true } }, playerTwo: { select: { id: true, nickname: true, avatarUrl: true } }, game: { select: { title: true, slug: true } }, winner: { select: { id: true, nickname: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
      });
      const hasMore = rows.length > limit;
      const matches = hasMore ? rows.slice(0, limit) : rows;
      return NextResponse.json({ matches, nextCursor: hasMore ? matches[matches.length - 1]?.id ?? null : null, hasMore });
    }
    const statusFilter: Prisma.MatchWhereInput = status === "waiting"
      ? (user
          ? {
              OR: [
                { status: "WAITING_FOR_PLAYERS" },
                { status: "READY", OR: [{ playerOneId: user.id }, { playerTwoId: user.id }] },
              ],
            }
          : { status: "WAITING_FOR_PLAYERS" })
      : status === "active"
      ? { status: { in: ["READY", "STARTING", "LIVE"] } }
      : { status: { in: ["WAITING_FOR_PLAYERS", "READY", "STARTING", "LIVE"] } };
    const matches = await prisma.match.findMany({ where: { ...economyFilter, ...statusFilter }, include: { playerOne: { select: { nickname: true, avatarUrl: true } }, playerTwo: { select: { nickname: true, avatarUrl: true } }, game: { select: { title: true, slug: true } }, winner: { select: { nickname: true } } }, orderBy: { createdAt: "desc" }, take: 100 });
    return NextResponse.json(matches);
  } catch (e) { console.error(e); return NextResponse.json({ error: "Не удалось загрузить матчи" }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Войдите в аккаунт, чтобы создать матч", errorCode: "AUTH_REQUIRED" }, { status: 401 });
    const body = await request.json();
    const economyMode = body.economyMode === undefined ? "REAL" : body.economyMode;
    if (economyMode !== "REAL" && economyMode !== "DEMO") return NextResponse.json({ error: "Недопустимый тип экономики", errorCode: "INVALID_ECONOMY_MODE" }, { status: 400 });
    const amount = Number(body.betAmount);
    const clientKey = String(request.headers.get("idempotency-key") || body.idempotencyKey || "").trim();
    if (!clientKey) return NextResponse.json({ error: "Idempotency-Key is required", errorCode: "IDEMPOTENCY_REQUIRED" }, { status: 400 });
    if (clientKey.length > 200) return NextResponse.json({ error: "Invalid idempotency key", errorCode: "INVALID_IDEMPOTENCY_KEY" }, { status: 400 });
    if (!(await getFeatureFlag("DUELS", true))) return NextResponse.json({ error: "Duels are temporarily disabled", errorCode: "FEATURE_DISABLED" }, { status: 503 });
    const mapConfig = getDuelMap(String(body.mapName ?? "aim_redline"));
    if (!mapConfig) return NextResponse.json({ error: "Недопустимая карта", errorCode: "INVALID_MAP" }, { status: 400 });
    const mode = String(body.mode || "SOLO_1V1");
    if (!isDuelMode(mode)) return NextResponse.json({ error: "Недопустимый режим дуэли", errorCode: "INVALID_MODE" }, { status: 400 });
    const weapon = normalizeModeWeaponModifier(mode, body.weaponModifier);
    if (!weapon.ok) return NextResponse.json({ error: "Модификатор оружия не соответствует режиму", errorCode: weapon.error }, { status: 400 });
    const format = String(body.format || "1v1");
    if (format !== "1v1") return NextResponse.json({ error: "Поддерживается только формат 1v1", errorCode: "INVALID_FORMAT" }, { status: 400 });
    if (!mapConfig.supportedModes[mode as keyof typeof mapConfig.supportedModes]) return NextResponse.json({ error: "Выбранный режим недоступен на этой карте", errorCode: "MODE_NOT_SUPPORTED_FOR_MAP" }, { status: 400 });
    const idempotencyKey = `match-create:${user.id}:${clientKey}`;
    const minBet = await getPlatformNumber("MIN_STAKE", MIN_BET), maxBet = await getPlatformNumber("MAX_STAKE", MAX_BET);
    if (!Number.isFinite(amount) || amount < minBet || amount > maxBet) {
      const range = economyMode === "DEMO"
        ? `${formatMatchAmount("DEMO", minBet)} до ${formatMatchAmount("DEMO", maxBet)}`
        : `$${minBet} до $${maxBet}`;
      return NextResponse.json({ error: `Ставка должна быть от ${range}`, errorCode: "INVALID_BET" }, { status: 400 });
    }
    const game = await prisma.game.findUnique({ where: { slug: "cs2" } });
    if (!game) return NextResponse.json({ error: "CS2 не найдена в базе", errorCode: "GAME_NOT_FOUND" }, { status: 404 });
    const commissionRate = await getPlatformNumber("COMMISSION_RATE", COMMISSION_RATE * 100) / 100;
    const fee = Number((amount * 2 * commissionRate).toFixed(4));

    const create = async (tx: Prisma.TransactionClient, demoContext?: Pick<DemoPolicyTransactionContext, "demo" | "policy">) => {
      await assertMatchmakingAvailable(tx);
      await assertAccountCanPlay(tx, user.id);
      await enforceRateLimit(tx, user.id, "MATCH_CREATE", 10, 60_000);
      if (demoContext) {
        await demoContext.policy.assertDemoUserCanCreateOrJoin(user.id, "CREATE");
        const existing = await tx.demoTransaction.findUnique({ where: { idempotencyKey } });
        if (existing) {
          if (existing.userId !== user.id || existing.type !== "MATCH_STAKE" || !existing.amount.eq(new Prisma.Decimal(amount).negated()) || !existing.matchId) throw new Error("IDEMPOTENCY_CONFLICT");
          const prior = await tx.match.findUnique({ where: { id: existing.matchId } });
          if (prior?.economyMode === "DEMO" && prior.playerOneId === user.id) return prior;
          throw new Error("IDEMPOTENCY_CONFLICT");
        }
      } else {
        const existing = await tx.transaction.findUnique({ where: { idempotencyKey } });
        if (existing?.referenceId) {
          const prior = await tx.match.findUnique({ where: { id: existing.referenceId } });
          if (prior) return prior;
        }
      }
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id}::uuid FOR UPDATE`;
      if (demoContext) {
        const racedRetry = await tx.demoTransaction.findUnique({ where: { idempotencyKey } });
        if (racedRetry) {
          if (racedRetry.userId !== user.id || racedRetry.type !== "MATCH_STAKE" || !racedRetry.amount.eq(new Prisma.Decimal(amount).negated()) || !racedRetry.matchId) throw new Error("IDEMPOTENCY_CONFLICT");
          const prior = await tx.match.findUnique({ where: { id: racedRetry.matchId } });
          if (prior?.economyMode === "DEMO" && prior.playerOneId === user.id) return prior;
          throw new Error("IDEMPOTENCY_CONFLICT");
        }
      }
      const busy = await tx.match.findFirst({ where: { status: { in: ["WAITING_FOR_PLAYERS", "READY", "STARTING", "LIVE"] }, OR: [{ playerOneId: user.id }, { playerTwoId: user.id }] }, select: { id: true } });
      if (busy) throw new Error("PLAYER_BUSY");
      if (!demoContext) {
        const risk = await assessUserRisk(tx, user.id);
        await recordFraudSignal(tx, user.id, risk.score, "High-risk duel creation", { flags: risk.flags, amount });
      }

      const activeModeConfig = await getActiveGameModeConfig(tx);
      const modeConfigSnapshot = buildMatchModeConfigSnapshot(activeModeConfig, mode, mapConfig.id, mapConfig.supportedModes[mode]);
      const modeConfigFields = {
        modeConfigSnapshot: {
          create: {
            revisionVersion: activeModeConfig.version > 0 ? activeModeConfig.version : null,
            snapshot: modeConfigSnapshot as Prisma.InputJsonValue,
          },
        },
      };

      if (demoContext) {
        const match = await tx.match.create({ data: { economyMode: "DEMO", gameId: game.id, playerOneId: user.id, mode: mode as DuelModeId, format, weaponModifier: weapon.weaponModifier, mapName: mapConfig.serverMapName, betAmount: amount, commission: fee, status: "WAITING_FOR_PLAYERS", connectionPhaseCompleted: false, ...modeConfigFields } });
        await demoContext.demo.reserveDemoStake(user.id, match.id, String(amount), idempotencyKey, `match-stake:${idempotencyKey}`);
        await tx.notification.create({ data: { userId: user.id, type: "SYSTEM", title: "DEMO match created", body: "Your DEMO match was created and is waiting for a second player. It uses virtual DC credits; real money was not affected.", payload: { economyMode: "DEMO", matchId: match.id, kind: "DEMO_MATCH_CREATED" } } });
        return match;
      }

      const debit = await debitWallet(tx, user.id, amount, idempotencyKey, "MATCH_BET", `Ставка на CS2 · ${mapConfig.serverMapName}`);
      if (debit.idempotent) throw new Error("IDEMPOTENCY_CONFLICT");
      await lockWallet(tx, user.id, amount, `match-stake:${idempotencyKey}`, "MATCH_STAKE", undefined, `Ставка зарезервирована · ${mapConfig.serverMapName}`);
      const match = await tx.match.create({ data: { gameId: game.id, playerOneId: user.id, mode: mode as DuelModeId, format, weaponModifier: weapon.weaponModifier, mapName: mapConfig.serverMapName, betAmount: amount, commission: fee, status: "WAITING_FOR_PLAYERS", connectionPhaseCompleted: false, ...modeConfigFields } });
      await tx.transaction.update({ where: { id: debit.transaction.id }, data: { referenceId: match.id } });
      const hold = await tx.walletHold.findUnique({ where: { idempotencyKey: `match-stake:${idempotencyKey}` } });
      if (hold) await tx.walletHold.update({ where: { id: hold.id }, data: { referenceId: match.id } });
      await tx.transaction.updateMany({ where: { idempotencyKey: `match-stake:${idempotencyKey}` }, data: { referenceId: match.id } });
      await tx.notification.create({
        data: {
          userId: user.id,
          type: "SYSTEM",
          status: "UNREAD",
          title: "Match created",
          body: "Your duel was created and is waiting for an opponent. The stake is reserved until the match starts.",
          payload: { economyMode: "REAL", matchId: match.id, kind: "MATCH_CREATED" },
        },
      });
      return match;
    };

    const result = economyMode === "DEMO"
      ? await withDemoPolicyTransaction(({ db, ...context }) => create(db, context))
      : await prisma.$transaction(tx => create(tx));
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "CS2_MAINTENANCE") return NextResponse.json({ error: "Идёт обновление серверов CS2. Пожалуйста, подождите", errorCode: code }, { status: 503 });
    if (code === "PLAYER_BUSY") return NextResponse.json({ error: "У вас уже есть активная дуэль. Завершите или дождитесь окончания текущей дуэли.", errorCode: code }, { status: 409 });
    if (code === "IDEMPOTENCY_CONFLICT") return NextResponse.json({ error: "Повторный ключ операции уже использован", errorCode: code }, { status: 409 });
    if (code === "INSUFFICIENT_DEMO_BALANCE") return NextResponse.json({ error: "Недостаточно виртуальных кредитов DC для создания DEMO-матча", errorCode: code }, { status: 400 });
    if (code === "INSUFFICIENT_BALANCE") return NextResponse.json({ error: "Недостаточно средств для создания матча", errorCode: code }, { status: 400 });
    if (code === "DEMO_USER_BLOCKED") return NextResponse.json({ error: "Создание DEMO-матчей для аккаунта отключено", errorCode: code }, { status: 403 });
    if (code === "DEMO_DISABLED") return NextResponse.json({ error: "DEMO-режим сейчас отключён", errorCode: code }, { status: 409 });
    if (code === "MODE_CONFIG_NOT_AVAILABLE") return NextResponse.json({ error: "Этот игровой режим пока недоступен на выбранной карте", errorCode: code }, { status: 409 });
    if (["ACCOUNT_SUSPENDED", "ACCOUNT_BANNED", "ACCOUNT_DEACTIVATED"].includes(code)) return NextResponse.json({ error: "Аккаунт временно недоступен для игры", errorCode: code }, { status: 403 });
    console.error(error); return NextResponse.json({ error: "Не удалось создать матч" }, { status: 500 });
  }
}
