import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const matches = await prisma.match.findMany({
    include: {
      playerOne: true,
      playerTwo: true,
      winner: true,
      loser: true,
      game: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return NextResponse.json(matches);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
const game = await prisma.game.findUnique({
  where: {
    slug: "cs2",
  },
});

const player = await prisma.user.findUnique({
  where: {
    nickname: "TestPlayer",
  },
});

if (!game) {
  return NextResponse.json(
    { error: "Игра CS2 не найдена" },
    { status: 404 }
  );
}

if (!player) {
  return NextResponse.json(
    { error: "Тестовый пользователь не найден" },
    { status: 404 }
  );
}
    const match = await prisma.match.create({
      data: {
        gameId: game.id,
        playerOneId: player.id,
        mode: body.mode,
        mapName: body.mapName,
        betAmount: body.betAmount,
        commission: body.commission,
        lobbyCode: body.lobbyCode ?? null,
      },
    });

    return NextResponse.json(match, { status: 201 });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Не удалось создать матч" },
      { status: 500 }
    );
  }
}