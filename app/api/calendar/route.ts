import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function statusFor(now: Date, startsAt: Date, endsAt: Date) {
  if (startsAt > now) return "UPCOMING";
  if (endsAt > now) return "ACTIVE";
  return "ENDED";
}

export async function GET() {
  const now = new Date();
  const horizon = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 90);

  const [events, tournaments, promos, seasons] = await Promise.all([
    prisma.event.findMany({
      where: { startsAt: { lte: horizon }, endsAt: { gte: now }, status: { not: "CANCELLED" } },
      orderBy: { startsAt: "asc" }, take: 100,
      select: { id: true, name: true, icon: true, startsAt: true, endsAt: true, theme: true, status: true, eventPass: true, premiumPass: true, premiumPrice: true, promoMultiplier: true },
    }),
    prisma.tournament.findMany({
      where: { OR: [{ startsAt: { gte: now, lte: horizon } }, { startsAt: null, status: { in: ["OPEN", "REGISTRATION", "LIVE"] } }, { endsAt: { gte: now }, status: { in: ["OPEN", "REGISTRATION", "LIVE"] } }] },
      orderBy: { startsAt: "asc" }, take: 100,
      select: { id: true, name: true, slug: true, startsAt: true, endsAt: true, status: true, maxPlayers: true, entryFee: true, prizePool: true },
    }),
    prisma.promoCampaign.findMany({
      where: { startsAt: { lte: horizon }, endsAt: { gte: now }, status: { in: ["SCHEDULED", "ACTIVE"] } },
      orderBy: { startsAt: "asc" }, take: 100,
      select: { id: true, name: true, type: true, startsAt: true, endsAt: true, multiplier: true, maxPayout: true, conditions: true, status: true },
    }),
    prisma.season.findMany({
      where: { endsAt: { gte: now } }, orderBy: { startsAt: "asc" }, take: 20,
      select: { id: true, name: true, theme: true, startsAt: true, endsAt: true, mode: true },
    }),
  ]);

  return NextResponse.json({
    generatedAt: now.toISOString(),
    events: events.map(x => ({ ...x, status: statusFor(now, x.startsAt, x.endsAt) })),
    tournaments: tournaments.map(x => ({ ...x, status: x.startsAt && x.endsAt ? statusFor(now, x.startsAt, x.endsAt) : x.status })),
    promotions: promos.map(x => ({ ...x, status: statusFor(now, x.startsAt, x.endsAt) })),
    seasons: seasons.map(x => ({ ...x, status: statusFor(now, x.startsAt, x.endsAt) })),
  }, { headers: { "Cache-Control": "no-store" } });
}
