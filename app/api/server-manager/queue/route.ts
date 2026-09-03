import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isServerManagerRequest } from "../auth";

const READY_CONNECT_TIMEOUT_MS = 10 * 60 * 1000;
const SERVER_START_TIMEOUT_MS = 5 * 60 * 1000;

export async function GET(request: NextRequest) {
  if (!isServerManagerRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = Date.now();

  const staleMatches = await prisma.match.findMany({
    where: {
      OR: [
        {
          status: "READY",
          updatedAt: {
            lt: new Date(now - SERVER_START_TIMEOUT_MS),
          },
          gameServer: null,
        },
      ],
    },
    select: {
      id: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: {
      createdAt: "asc",
    },
    take: 50,
  });

  for (const match of staleMatches) {
    try {
      await prisma.$transaction(async (tx) => {
        const current = await tx.match.findUnique({
          where: { id: match.id },
          include: { gameServer: true },
        });

        if (!current) return;

        const currentConfig =
          current.serverConfig &&
          typeof current.serverConfig === "object" &&
          !Array.isArray(current.serverConfig)
            ? (current.serverConfig as Record<string, unknown>)
            : {};

        const managerRequested = currentConfig.managerRequested === true;

        const readyTimeoutMs = managerRequested
          ? SERVER_START_TIMEOUT_MS
          : READY_CONNECT_TIMEOUT_MS;

        const isReadyExpired =
          current.status === "READY" &&
          !current.gameServer &&
          Date.now() - current.updatedAt.getTime() >= readyTimeoutMs;

        if (!isReadyExpired) return;

        const amount = Number(current.betAmount);

        const playerIds = [
          current.playerOneId,
          current.playerTwoId,
        ].filter((id): id is string => Boolean(id));

        for (const playerId of playerIds) {
          const wallet = await tx.wallet.findUnique({
            where: { userId: playerId },
          });

          if (!wallet) continue;

          const before = Number(wallet.balance);
          const after = before + amount;

          await tx.wallet.update({
            where: { id: wallet.id },
            data: {
              balance: after,
              lockedBalance: {
                decrement: amount,
              },
            },
          });

          await tx.transaction.create({
            data: {
              walletId: wallet.id,
              type: "REFUND",
              status: "COMPLETED",
              amount,
              balanceBefore: before,
              balanceAfter: after,
              referenceId: current.id,
              description: managerRequested
                ? "Возврат ставки: сервер не был запущен вовремя"
                : "Возврат ставки: матч не был запущен вовремя",
            },
          });
        }

        await tx.match.update({
          where: { id: current.id },
          data: {
            status: "CANCELLED",
            endedAt: new Date(),
          },
        });

        console.log(
          `[SERVER-MANAGER] Auto-cancelled stale match ${current.id} (${current.status})`,
        );
      });
    } catch (error) {
      console.error(
        `[SERVER-MANAGER] Failed to auto-cancel match ${match.id}`,
        error,
      );
    }
  }

  const candidates = await prisma.match.findMany({
    where: {
      status: "READY",
      playerTwoId: { not: null },
      gameServer: null,
    },
    include: {
      playerOne: {
        select: {
          id: true,
          steamId: true,
          nickname: true,
        },
      },
      playerTwo: {
        select: {
          id: true,
          steamId: true,
          nickname: true,
        },
      },
    },
    orderBy: {
      createdAt: "asc",
    },
    take: 20,
  });

  const pending = candidates.find((match) => {
    const cfg = match.serverConfig;

    return Boolean(
      cfg &&
        typeof cfg === "object" &&
        !Array.isArray(cfg) &&
        (cfg as Record<string, unknown>).managerRequested === true,
    );
  });

  return NextResponse.json({
    pending: pending
      ? {
          id: pending.id,
          mapName: pending.mapName ?? "Dust2",
          playerOne: pending.playerOne,
          playerTwo: pending.playerTwo,
          betAmount: pending.betAmount.toString(),
        }
      : null,
  });
}
