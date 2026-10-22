import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { withDemoTransaction } from "@/lib/demo-wallet";

const MAX_DAYS = 30;

type CanonicalReward = { day: number; balance: number; cosmeticSlug?: string };

const CANONICAL_LOGIN_REWARDS: CanonicalReward[] = [
  { day: 1, balance: 20 },
  { day: 2, balance: 20 },
  { day: 3, balance: 25 },
  { day: 4, balance: 25 },
  { day: 5, balance: 30 },
  { day: 6, balance: 30 },
  { day: 7, balance: 75, cosmeticSlug: "frame-neon-pulse" },
  { day: 8, balance: 25 },
  { day: 9, balance: 30 },
  { day: 10, balance: 35 },
  { day: 11, balance: 35 },
  { day: 12, balance: 40 },
  { day: 13, balance: 40 },
  { day: 14, balance: 100 },
  { day: 15, balance: 100, cosmeticSlug: "frame-electric-storm" },
  { day: 16, balance: 40 },
  { day: 17, balance: 40 },
  { day: 18, balance: 45 },
  { day: 19, balance: 45 },
  { day: 20, balance: 50 },
  { day: 21, balance: 150 },
  { day: 22, balance: 45 },
  { day: 23, balance: 50 },
  { day: 24, balance: 50 },
  { day: 25, balance: 55 },
  { day: 26, balance: 55 },
  { day: 27, balance: 60 },
  { day: 28, balance: 200 },
  { day: 29, balance: 75 },
  { day: 30, balance: 1000, cosmeticSlug: "frame-inferno-crown" },
];

function canonicalReward(day: number): CanonicalReward | null {
  return CANONICAL_LOGIN_REWARDS.find((reward) => reward.day === day) ?? null;
}

function utcDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function nextSequence(last: { cycle: number; day: number } | null) {
  if (!last) return { cycle: 1, day: 1 };
  if (last.day >= MAX_DAYS) return { cycle: last.cycle + 1, day: 1 };
  return { cycle: last.cycle, day: last.day + 1 };
}

function normalizeReward(reward: unknown, fallback: CanonicalReward) {
  const base = reward && typeof reward === "object" && !Array.isArray(reward)
    ? { ...(reward as Record<string, unknown>) }
    : {};
  if (base.balance === undefined && base.coins === undefined && base.amount !== undefined) {
    base.balance = base.amount;
  }
  if (base.balance === undefined) base.balance = fallback.balance;
  if (base.cosmeticSlug === undefined && fallback.cosmeticSlug) base.cosmeticSlug = fallback.cosmeticSlug;
  return base;
}

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const claimed = await prisma.userLoginReward.findMany({
    where: { userId: me.id },
    orderBy: { claimedAt: "desc" },
    take: 90,
  });

  const today = utcDateKey(new Date());
  const todayClaim = claimed.find((x) => x.claimDate === today) ?? null;
  const last = claimed[0] ?? null;
  const next = nextSequence(last);

  return NextResponse.json({
    rewards: CANONICAL_LOGIN_REWARDS.map((reward) => ({ day: reward.day, reward, active: true })),
    claimed: claimed.map((claim) => ({
      ...claim,
      reward: normalizeReward(claim.reward, canonicalReward(claim.day) ?? { day: claim.day, balance: 0 }),
    })),
    todayClaim: todayClaim
      ? { ...todayClaim, reward: normalizeReward(todayClaim.reward, canonicalReward(todayClaim.day) ?? { day: todayClaim.day, balance: 0 }) }
      : null,
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
    const result = await withDemoTransaction(async (context) => {
      const tx = context.db;
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id = ${me.id}::uuid FOR UPDATE`);

      const now = new Date();
      const claimDate = utcDateKey(now);
      const existingToday = await tx.userLoginReward.findUnique({
        where: { userId_claimDate: { userId: me.id, claimDate } },
      });

      const last = existingToday
        ? { cycle: existingToday.cycle, day: existingToday.day }
        : await tx.userLoginReward.findFirst({
            where: { userId: me.id },
            orderBy: { claimedAt: "desc" },
            select: { cycle: true, day: true },
          });

      const { cycle, day } = existingToday
        ? { cycle: existingToday.cycle, day: existingToday.day }
        : nextSequence(last);

      const rewardDefinition = canonicalReward(day);
      if (!rewardDefinition) throw new Error("NOT_FOUND");

      if (existingToday) {
        const storedReward = normalizeReward(existingToday.reward, rewardDefinition);
        const amount = Number(storedReward.balance ?? rewardDefinition.balance);
        const idempotencyKey = `login-reward:${existingToday.id}`;
        const priorTransaction = await tx.demoTransaction.findUnique({ where: { idempotencyKey } });
        const granted = priorTransaction
          ? { transaction: priorTransaction, idempotent: true }
          : await context.demo.adjustDemoCredits(
              me.id,
              new Prisma.Decimal(String(amount)),
              idempotencyKey,
              `Login reward recovery · Cycle ${existingToday.cycle} · Day ${existingToday.day}`,
            );

        if (storedReward.cosmeticSlug) {
          const item = await tx.cosmeticItem.findUnique({ where: { slug: String(storedReward.cosmeticSlug) } });
          if (item) {
            const owned = await tx.cosmeticPurchase.findUnique({ where: { userId_itemId: { userId: me.id, itemId: item.id } } });
            if (!owned) await tx.cosmeticPurchase.create({ data: { userId: me.id, itemId: item.id, price: 0 } });
          }
        }

        return {
          row: { ...existingToday, reward: storedReward },
          granted: { balance: Number(granted.transaction.amount), idempotent: granted.idempotent ?? true },
          idempotent: true,
          recovered: !priorTransaction,
        };
      }

      const row = await tx.userLoginReward.create({
        data: {
          userId: me.id,
          cycle,
          day,
          claimDate,
          reward: { balance: rewardDefinition.balance, ...(rewardDefinition.cosmeticSlug ? { cosmeticSlug: rewardDefinition.cosmeticSlug } : {}) },
        },
      });

      const granted = await context.demo.adjustDemoCredits(
        me.id,
        new Prisma.Decimal(String(rewardDefinition.balance)),
        `login-reward:${row.id}`,
        `Login reward · Cycle ${cycle} · Day ${day}`,
      );

      if (rewardDefinition.cosmeticSlug) {
        const item = await tx.cosmeticItem.findUnique({ where: { slug: rewardDefinition.cosmeticSlug } });
        if (item) {
          const owned = await tx.cosmeticPurchase.findUnique({ where: { userId_itemId: { userId: me.id, itemId: item.id } } });
          if (!owned) await tx.cosmeticPurchase.create({ data: { userId: me.id, itemId: item.id, price: 0 } });
        }
      }

      return {
        row: { ...row, reward: { balance: rewardDefinition.balance, ...(rewardDefinition.cosmeticSlug ? { cosmeticSlug: rewardDefinition.cosmeticSlug } : {}) } },
        granted: { balance: Number(granted.transaction.amount), idempotent: granted.idempotent },
      };
    });

    return NextResponse.json(result, { status: result.idempotent ? 200 : 201 });
  } catch (e) {
    console.error("login-rewards claim failed", e);
    const code = e instanceof Error ? e.message : "";
    return NextResponse.json(
      { error: code === "ALREADY" ? "Daily reward already claimed" : code === "NOT_FOUND" ? "Reward not found" : "Could not claim reward", code },
      { status: code === "ALREADY" ? 409 : code === "NOT_FOUND" ? 404 : 500 },
    );
  }
}