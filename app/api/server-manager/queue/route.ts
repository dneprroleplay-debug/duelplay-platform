import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isServerManagerRequest } from "../auth";

const WAITING_TIMEOUT_MS = 10 * 60 * 1000;
const READY_TIMEOUT_MS = 5 * 60 * 1000;

export async function GET(request: NextRequest) {
  if (!isServerManagerRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = Date.now();

  const staleMatches = await prisma.match.findMany({
    where: {
      OR: [
        {
          status: "WAITING_FOR_PLAYERS",
          createdAt: {
            lt: new Date(now - WAITING_TIMEOUT_MS),
          },
        },
        {
          status: "READY",
          updatedAt: {
            lt: new Date(now - READY_TIMEOUT_MS),
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

        const isWaitingExpired =
          current.status === "WAITING_FOR_PLAYERS" &&
          Date.now() - current.createdAt.getTime() >= WAITING_TIMEOUT_MS;

        const isReadyExpired =
          current.status === "READY" &&
          !current.gameServer &&
          Date.now() - current.updatedAt.getTime() >= READY_TIMEOUT_MS;

        if (!isWaitingExpired && !isReadyExpired) return;

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
              description: isWaitingExpired
                ? "Возврат ставки: соперник не присоединился вовремя"
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
