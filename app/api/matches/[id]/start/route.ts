import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { cancelMatchWithRefund, lockMatchForUpdate } from "@/lib/match-lifecycle";
import { MATCH_SERVER_START_TIMEOUT_MS } from "@/lib/match-timers";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Войдите в аккаунт" }, { status: 401 });
  const { id } = await params;

  try {
    const preflight = await prisma.match.findUnique({ where: { id }, select: { status: true, startDeadlineAt: true } });
    if (!preflight) throw new Error("NOT_FOUND");
    if (preflight.status === "READY" && preflight.startDeadlineAt && preflight.startDeadlineAt.getTime() <= Date.now()) {
      await cancelMatchWithRefund(id, "START timeout expired");
      throw new Error("START_EXPIRED");
    }

    const result = await prisma.$transaction(async tx => {
      const locked = await lockMatchForUpdate(tx, id);
      if (!locked) throw new Error("NOT_FOUND");
      const match = await tx.match.findUnique({
        where: { id },
        include: {
          gameServer: true,
          playerOne: { select: { steamId: true, isTestAccount: true } },
          playerTwo: { select: { steamId: true, isTestAccount: true } },
        },
      });
      if (!match) throw new Error("NOT_FOUND");
      if (![match.playerOneId, match.playerTwoId].includes(user.id)) throw new Error("FORBIDDEN");
      if (!match.playerTwoId) throw new Error("NOT_READY");
      if (match.status === "STARTING" || match.gameServer) return { match, alreadyStarting: true, localTest: false };
      if (match.status !== "READY") throw new Error("NOT_READY");

      const bothTestAccounts = match.playerOne.isTestAccount === true && match.playerTwo?.isTestAccount === true;
      if ((!match.playerOne.steamId || !match.playerTwo?.steamId) && !bothTestAccounts) throw new Error("STEAM_REQUIRED");

      const current = match.serverConfig && typeof match.serverConfig === "object" && !Array.isArray(match.serverConfig)
        ? match.serverConfig as Record<string, unknown>
        : {};
      const localTestMode = process.env.NODE_ENV !== "production" && bothTestAccounts && process.env.DUELPLAY_LOCAL_TEST_MODE !== "false";
      if (localTestMode) {
        const updated = await tx.match.update({
          where: { id },
          data: {
            status: "LIVE",
            startedAt: new Date(),
            startDeadlineAt: null,
            connectionDeadlineAt: null,
            connectionPhaseCompleted: true,
            serverConfig: {
              ...current,
              state: "READY",
              localTest: true,
              managerRequested: false,
              connectUrl: null,
              requestedAt: new Date().toISOString(),
            },
          },
        });
        return { match: updated, alreadyStarting: false, localTest: true };
      }

      const updated = await tx.match.update({
        where: { id },
        data: {
          startDeadlineAt: new Date(Date.now() + MATCH_SERVER_START_TIMEOUT_MS),
          status: "STARTING",
          serverConfig: {
            ...current,
            state: "QUEUED",
            managerRequested: true,
            requestedAt: new Date().toISOString(),
          },
        },
      });
      return { match: updated, alreadyStarting: false, localTest: false };
    });

    return NextResponse.json(result.localTest ? { ...result.match, localTest: true } : result.match);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOT_FOUND") return NextResponse.json({ error: "Матч не найден" }, { status: 404 });
    if (code === "FORBIDDEN") return NextResponse.json({ error: "Вы не участник матча" }, { status: 403 });
    if (code === "NOT_READY") return NextResponse.json({ error: "Матч не готов к старту" }, { status: 409 });
    if (code === "STEAM_REQUIRED") return NextResponse.json({ error: "Оба игрока должны привязать Steam", errorCode: "STEAM_REQUIRED" }, { status: 409 });
    if (code === "START_EXPIRED") return NextResponse.json({ error: "Время на запуск матча истекло. Матч отменён, ставки возвращены.", errorCode: "START_EXPIRED" }, { status: 409 });
    console.error(error);
    return NextResponse.json({ error: "Не удалось запустить матч" }, { status: 500 });
  }
}
