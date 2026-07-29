import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

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