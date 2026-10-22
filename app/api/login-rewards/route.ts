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

function normalizeReward(reward: unknown) {
  if (!reward || typeof reward !== "object" || Array.isArray(reward)) return reward;
  const source = reward as Record<string, unknown>;
  const balance = source.balance ?? source.coins ?? source.amount;
  return { ...source, balance };
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
    rewards: rewards.map((reward) => ({ ...reward, reward: normalizeReward(reward.reward) })),
    claimed: claimed.map((claim) => ({ ...claim, reward: normalizeReward(claim.reward) })),
    todayClaim: todayClaim ? { ...todayClaim, reward: normalizeReward(todayClaim.reward) } : null,
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
const normalizedReward = normalizeReward(reward.reward);

const row = await tx.userLoginReward.create({
  data: {
    userId: me.id,
    cycle,
    day,
    claimDate,
    reward: normalizedReward === null ? Prisma.JsonNull : (normalizedReward as Prisma.InputJsonValue),
  },
});
const granted = await grantReward(
  tx,
  me.id,
  normalizedReward,
  `login-reward:${row.id}`,
  `Login reward · Cycle ${cycle} · Day ${day}`,
  row.id,
);
return { row: { ...row, reward: normalizedReward }, granted };
    });

    return NextResponse.json(result, { status: 201 });
} catch (e) {
  console.error("login-rewards claim failed", e);
  const code = e instanceof Error ? e.message : "";
  return NextResponse.json(
    { error: code === "ALREADY" ? "Daily reward already claimed" : code === "NOT_FOUND" ? "Reward not found" : "Could not claim reward", code },
    { status: code === "ALREADY" ? 409 : code === "NOT_FOUND" ? 404 : 500 },
  );
}
}
