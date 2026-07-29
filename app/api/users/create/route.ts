import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const match = await prisma.match.create({
      data: {
        creatorId: body.creatorId,
        mode: body.mode,
        map: body.map,
        bet: body.bet,
      },
    });

    return NextResponse.json(match);
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Failed to create match" },
      { status: 500 }
    );
  }
}