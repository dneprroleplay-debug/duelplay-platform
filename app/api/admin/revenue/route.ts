import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin";

const REVENUE_TYPES = [
  "COMMISSION", "CASE_OPEN", "COSMETIC_PURCHASE", "PRIME_PURCHASE",
  "DUELPASS_PURCHASE", "EVENTPASS_PURCHASE", "XP_BOOSTER_PURCHASE",
] as const;
const EXPENSE_TYPES = ["REFERRAL", "REFERRAL_RACE_PRIZE", "TOURNAMENT_PRIZE"] as const;
const ALL_TYPES = [...REVENUE_TYPES, ...EXPENSE_TYPES] as const;

function amountByType(rows: Array<{ type: string; amount: unknown }>) {
  const out: Record<string, number> = {};
  for (const row of rows) out[row.type] = (out[row.type] ?? 0) + Math.max(0, Number(row.amount));
  return out;
}

function parseDate(value: string | null, fallback: Date) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export async function GET(request: Request) {
  try {
    const me = await requireAdmin(3);
    const url = new URL(request.url);
    const now = new Date();
    const from = parseDate(url.searchParams.get("from"), new Date(now.getTime() - 30 * 86400000));
    const to = parseDate(url.searchParams.get("to"), now);
    if (!from || !to || from > to) return NextResponse.json({ error: "Invalid date range" }, { status: 400 });

    const rows = await prisma.transaction.findMany({
      where: { status: "COMPLETED", createdAt: { gte: from, lte: to } },
      select: { type: true, amount: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    const byType = amountByType(rows);
    const revenue = REVENUE_TYPES.reduce((sum, type) => sum + (byType[type] ?? 0), 0);
    const expenses = EXPENSE_TYPES.reduce((sum, type) => sum + (byType[type] ?? 0), 0);

    const days = new Map<string, { revenue: number; expenses: number; transactions: number }>();
    for (const row of rows) {
      const key = row.createdAt.toISOString().slice(0, 10);
      const bucket = days.get(key) ?? { revenue: 0, expenses: 0, transactions: 0 };
      if ((REVENUE_TYPES as readonly string[]).includes(row.type)) bucket.revenue += Math.max(0, Number(row.amount));
      if ((EXPENSE_TYPES as readonly string[]).includes(row.type)) bucket.expenses += Math.max(0, Number(row.amount));
      bucket.transactions += 1;
      days.set(key, bucket);
    }

    const categories = {
      commission: byType.COMMISSION ?? 0,
      cases: byType.CASE_OPEN ?? 0,
      cosmetics: byType.COSMETIC_PURCHASE ?? 0,
      prime: byType.PRIME_PURCHASE ?? 0,
      duelPass: byType.DUELPASS_PURCHASE ?? 0,
      eventPass: byType.EVENTPASS_PURCHASE ?? 0,
      xpBoosters: byType.XP_BOOSTER_PURCHASE ?? 0,
      referralPayouts: byType.REFERRAL ?? 0,
      referralRacePrizes: byType.REFERRAL_RACE_PRIZE ?? 0,
      tournamentPrizes: byType.TOURNAMENT_PRIZE ?? 0,
    };

    return NextResponse.json({
      from: from.toISOString(),
      to: to.toISOString(),
      admin: { id: me.id, role: me.role },
      categories,
      byType: Object.fromEntries(ALL_TYPES.map(type => [type, byType[type] ?? 0])),
      daily: [...days.entries()].map(([date, value]) => ({ date, ...value, netRevenue: value.revenue - value.expenses })),
      revenue,
      expenses,
      netRevenue: revenue - expenses,
      transactionCount: rows.length,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "FORBIDDEN") return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    console.error("admin revenue failed", error);
    return NextResponse.json({ error: "Не удалось загрузить аналитику доходов" }, { status: 500 });
  }
}
