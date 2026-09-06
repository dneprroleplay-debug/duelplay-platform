import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { grantReward } from "@/lib/rewards";

const MAX_DAYS = 30;

function utcDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function nextSequence(last: { cycle: number; day: number } | null) {
  if (!last) return { cycle: 1, day: 1 };
  if (last.day >= MAX_DAYS) return { cycle: last.cycle + 1, day: 1 };
  return { cycle: last.cycle, day: last.day + 1 };
}

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [rewards, claimed] = await Promise.all([
    prisma.loginReward.findMany({ where: { active: true }, orderBy: { day: "asc" } }),
    prisma.userLoginReward.findMany({ where: { userId: me.id }, orderBy: { claimedAt: "desc" }, take: 90 }),
  ]);

  const today = utcDateKey(new Date());
  const todayClaim = claimed.find((x) => x.claimDate === today) ?? null;
  const last = claimed[0] ?? null;
  const next = nextSequence(last);

  return NextResponse.json({
    rewards,
    claimed,
    todayClaim,
    currentCycle: next.cycle,
    nextDay: next.day,
    canClaim: !todayClaim,
    maxDays: MAX_DAYS,
  });
}

export async function POST(_r: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Serialize claims per user. This closes the race where two browser tabs
      // could both observe "not claimed today" and create two rewards.
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id = ${me.id} FOR UPDATE`);

      const now = new Date();
      const claimDate = utcDateKey(now);
      const existingToday = await tx.userLoginReward.findUnique({
        where: { userId_claimDate: { userId: me.id, claimDate } },
      });
      if (existingToday) throw new Error("ALREADY");

      const last = await tx.userLoginReward.findFirst({
        where: { userId: me.id },
        orderBy: { claimedAt: "desc" },
        select: { cycle: true, day: true },
      });
      const { cycle, day } = nextSequence(last);
      const reward = await tx.loginReward.findUnique({ where: { day } });
      if (!reward || !reward.active) throw new Error("NOT_FOUND");

      const row = await tx.userLoginReward.create({
        data: {
          userId: me.id,
          cycle,
          day,
          claimDate,
          reward: reward.reward === null ? Prisma.JsonNull : reward.reward,
        },
      });
      const granted = await grantReward(
        tx,
        me.id,
        reward.reward,
        `login-reward:${row.id}`,
        `Login reward · Cycle ${cycle} · Day ${day}`,
        row.id,
      );
      return { row, granted };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    const code = e instanceof Error ? e.message : "";
    return NextResponse.json(
      { error: code === "ALREADY" ? "Daily reward already claimed" : code === "NOT_FOUND" ? "Reward not found" : "Could not claim reward" },
      { status: code === "ALREADY" ? 409 : 400 },
    );
  }
}
