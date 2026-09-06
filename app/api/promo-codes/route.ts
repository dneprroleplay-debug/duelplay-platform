import { getFeatureFlag } from "@/lib/feature-flags";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { requireAdmin, audit } from "@/lib/admin";
import { creditWallet } from "@/lib/wallet";

function cleanCode(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

export async function POST(request: NextRequest) {
  if (!(await getFeatureFlag("PROMOS", false))) return NextResponse.json({ error: "Promotions are temporarily disabled", errorCode: "FEATURE_DISABLED" }, { status: 503 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const code = cleanCode(body.code);
  if (!code) return NextResponse.json({ error: "Промокод обязателен" }, { status: 400 });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{
        id: string; bonusAmount: unknown; maxUses: number | null; usesCount: number;
        expiresAt: Date | null; isActive: boolean;
      }>>`SELECT id, "bonusAmount", "maxUses", "usesCount", "expiresAt", "isActive"
          FROM "PromoCode" WHERE code = ${code} LIMIT 1 FOR UPDATE`;
      const promo = rows[0];
      if (!promo) throw new Error("PROMO_NOT_FOUND");
      if (!promo.isActive) throw new Error("PROMO_INACTIVE");
      if (promo.expiresAt && promo.expiresAt <= new Date()) throw new Error("PROMO_EXPIRED");
      if (promo.maxUses !== null && promo.usesCount >= promo.maxUses) throw new Error("PROMO_LIMIT");
      const bonus = Number(promo.bonusAmount);
      if (!Number.isFinite(bonus) || bonus <= 0) throw new Error("PROMO_INVALID");

      const existing = await tx.promoCodeUse.findUnique({
        where: { promoCodeId_userId: { promoCodeId: promo.id, userId: user.id } },
      });
      if (existing) throw new Error("PROMO_ALREADY_USED");

      const use = await tx.promoCodeUse.create({ data: { promoCodeId: promo.id, userId: user.id } });
      await tx.promoCode.update({ where: { id: promo.id }, data: { usesCount: { increment: 1 } } });
      const credited = await creditWallet(tx, user.id, bonus, `promo-code:${promo.id}:${user.id}`, "BONUS", `Promo code ${code}`, use.id);
      await tx.notification.create({
        data: {
          userId: user.id,
          type: "PROMO_ACTIVATED",
          title: "Promo code activated",
          body: `$${bonus.toFixed(2)} bonus added to your DuelPlay balance.`,
          payload: { promoCodeId: promo.id, code },
        },
      });
      return { bonus, balance: Number(credited.transaction.balanceAfter) };
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    const errors: Record<string, string> = {
      PROMO_NOT_FOUND: "Промокод не найден",
      PROMO_INACTIVE: "Промокод неактивен",
      PROMO_EXPIRED: "Срок действия промокода истёк",
      PROMO_LIMIT: "Лимит использования промокода исчерпан",
      PROMO_ALREADY_USED: "Вы уже использовали этот промокод",
      PROMO_INVALID: "Промокод настроен некорректно",
    };
    if (errors[message]) return NextResponse.json({ error: errors[message] }, { status: 400 });
    throw error;
  }
}

export async function GET() {
  if (!(await getFeatureFlag("PROMOS", false))) return NextResponse.json({ error: "Promotions are temporarily disabled", errorCode: "FEATURE_DISABLED" }, { status: 503 });
  try {
    await requireAdmin(5);
    const rows = await prisma.promoCode.findMany({ orderBy: { createdAt: "desc" } });
    return NextResponse.json(rows.map((row) => ({ ...row, bonusAmount: row.bonusAmount.toString() })));
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
}

export async function PUT(request: NextRequest) {
  if (!(await getFeatureFlag("PROMOS", false))) return NextResponse.json({ error: "Promotions are temporarily disabled", errorCode: "FEATURE_DISABLED" }, { status: 503 });
  try {
    const me = await requireAdmin(5);
    const body = await request.json().catch(() => ({}));
    const id = String(body.id || "");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const data: Record<string, unknown> = {};
    if (body.code !== undefined) data.code = cleanCode(body.code);
    if (body.bonusAmount !== undefined) data.bonusAmount = Number(body.bonusAmount);
    if (body.maxUses !== undefined) data.maxUses = body.maxUses == null ? null : Number(body.maxUses);
    if (body.expiresAt !== undefined) data.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
    if (data.code === "") return NextResponse.json({ error: "code required" }, { status: 400 });
    if (data.bonusAmount !== undefined && (!Number.isFinite(data.bonusAmount as number) || (data.bonusAmount as number) <= 0)) return NextResponse.json({ error: "Invalid bonus" }, { status: 400 });
    if (data.maxUses !== undefined && data.maxUses !== null && (!Number.isInteger(data.maxUses as number) || (data.maxUses as number) <= 0)) return NextResponse.json({ error: "Invalid maxUses" }, { status: 400 });
    const row = await prisma.promoCode.update({ where: { id }, data: data as never });
    await audit(me.id, "UPDATE_PROMO_CODE", "PROMO_CODE", id, { changes: data });
    return NextResponse.json(row);
  } catch (error) {
    if (error instanceof Error && error.message === "FORBIDDEN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    throw error;
  }
}

export async function PATCH(request: NextRequest) {
  if (!(await getFeatureFlag("PROMOS", false))) return NextResponse.json({ error: "Promotions are temporarily disabled", errorCode: "FEATURE_DISABLED" }, { status: 503 });
  return PUT(request);
}
