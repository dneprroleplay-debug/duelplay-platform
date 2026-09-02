import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Войдите в аккаунт" }, { status: 401 });
  const { id } = await params;
  const match = await prisma.match.findUnique({ where: { id }, include: { gameServer: true, playerOne: { select: { steamId: true } }, playerTwo: { select: { steamId: true } } } });
  if (!match) return NextResponse.json({ error: "Матч не найден" }, { status: 404 });
  if (![match.playerOneId, match.playerTwoId].includes(user.id)) return NextResponse.json({ error: "Вы не участник матча" }, { status: 403 });
  if (!match.playerTwoId || match.status !== "READY") return NextResponse.json({ error: "Матч не готов к старту" }, { status: 409 });
  if (!match.playerOne.steamId || !match.playerTwo?.steamId) return NextResponse.json({ error: "Оба игрока должны привязать Steam" }, { status: 409 });
  if (match.gameServer) return NextResponse.json({ error: "Сервер для этой дуэли уже готовится" }, { status: 409 });

  const current = match.serverConfig && typeof match.serverConfig === "object" && !Array.isArray(match.serverConfig) ? match.serverConfig as Record<string, unknown> : {};
  const updated = await prisma.match.update({
    where: { id },
    data: {
      serverConfig: {
        ...current,
        state: "QUEUED",
        managerRequested: true,
        requestedAt: new Date().toISOString(),
      },
    },
  });
  return NextResponse.json(updated);
}
