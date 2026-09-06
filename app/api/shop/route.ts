import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { debitWallet } from "@/lib/wallet";
import { normalizeCosmeticType, scopedShopIdempotencyKey, validateCosmeticMetadata, validateCosmeticPrice, COSMETIC_TYPES } from "@/lib/cosmetic-shop";

const MAX_PAGE_SIZE = 48;
const MAX_SEARCH = 80;

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, { ...init, headers: { "Cache-Control": "private, no-store", ...(init?.headers || {}) } });
}

export async function GET(r: NextRequest) {
  const me = await getCurrentUser();
  const sp = r.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page") || 1) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(sp.get("pageSize") || 24) || 24));
  const search = String(sp.get("search") || "").trim().slice(0, MAX_SEARCH);
  const type = String(sp.get("type") || "").trim().toUpperCase();
  const owned = sp.get("owned");
  const sort = String(sp.get("sort") || "price_asc");
  const where = {
    active: true,
    ...(type && type !== "ALL" && COSMETIC_TYPES.includes(type as typeof COSMETIC_TYPES[number]) ? { type } : {}),
    ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" as const } }, { slug: { contains: search, mode: "insensitive" as const } }] } : {}),
  };
  const orderBy = sort === "price_desc" ? [{ price: "desc" as const }, { createdAt: "desc" as const }] : sort === "newest" ? [{ createdAt: "desc" as const }] : [{ price: "asc" as const }, { createdAt: "desc" as const }];
  const allCount = await prisma.cosmeticItem.count({ where });
  const ownedRows = me ? await prisma.cosmeticPurchase.findMany({ where: { userId: me.id }, select: { itemId: true, createdAt: true } }) : [];
  const ownedMap = new Map(ownedRows.map(x => [x.itemId, x.createdAt]));
  const filteredOwned = owned === "true" ? { ...where, id: { in: [...ownedMap.keys()] } } : owned === "false" ? { ...where, id: { notIn: [...ownedMap.keys()] } } : where;
  const total = owned === "true" || owned === "false" ? await prisma.cosmeticItem.count({ where: filteredOwned }) : allCount;
  const items = await prisma.cosmeticItem.findMany({ where: filteredOwned, orderBy, skip: (page - 1) * pageSize, take: pageSize });
  return json({ items: items.map(x => ({ ...x, price: Number(x.price), owned: ownedMap.has(x.id), ownedAt: ownedMap.get(x.id) ?? null })), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), filters: { search, type: type || "ALL", owned: owned ?? "all", sort } });
}

export async function POST(r: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return json({ error: "Unauthorized" }, { status: 401 });
  const body = await r.json().catch(() => ({}));
  const itemId = String(body.itemId || "");
  if (!itemId) return json({ error: "Item not found" }, { status: 404 });
  const rawKey = String(r.headers.get("idempotency-key") || randomUUID()).trim();
  if (!rawKey || rawKey.length > 200) return json({ error: "Invalid idempotency key" }, { status: 400 });
  const idem = scopedShopIdempotencyKey(me.id, rawKey);
  try {
    const out = await prisma.$transaction(async tx => {
      const existingTx = await tx.transaction.findUnique({ where: { idempotencyKey: idem } });
      if (existingTx) {
        if (existingTx.referenceId !== itemId) throw new Error("IDEMPOTENCY_KEY_REUSED");
        const existingPurchase = await tx.cosmeticPurchase.findFirst({ where: { userId: me.id, itemId } });
        if (!existingPurchase) throw new Error("IDEMPOTENCY_INCOMPLETE");
        return { purchase: existingPurchase, balance: Number(existingTx.balanceAfter), idempotent: true };
      }
      const item = await tx.cosmeticItem.findFirst({ where: { id: itemId, active: true } });
      if (!item) throw new Error("ITEM");
      const alreadyOwned = await tx.cosmeticPurchase.findUnique({ where: { userId_itemId: { userId: me.id, itemId: item.id } } });
      if (alreadyOwned) throw new Error("ALREADY_OWNED");
      const price = validateCosmeticPrice(item.price);
      normalizeCosmeticType(item.type);
      validateCosmeticMetadata(item.metadata);
      const purchase = await tx.cosmeticPurchase.create({ data: { userId: me.id, itemId: item.id, price } });
      await debitWallet(tx, me.id, price, idem, "COSMETIC_PURCHASE", `Cosmetic purchase ${item.slug}`, item.id);
      const wallet = await tx.wallet.findUnique({ where: { userId: me.id }, select: { balance: true } });
      return { purchase, balance: Number(wallet?.balance ?? 0), idempotent: false };
    }, { isolationLevel: "Serializable" });
    return json(out, { status: out.idempotent ? 200 : 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    const status = message === "ALREADY_OWNED" || message === "IDEMPOTENCY_KEY_REUSED" ? 409 : message === "INSUFFICIENT_BALANCE" ? 400 : message === "ITEM" ? 404 : 400;
    const error = message === "ALREADY_OWNED" ? "Already owned" : message === "IDEMPOTENCY_KEY_REUSED" ? "Idempotency key was already used for another item" : message === "INSUFFICIENT_BALANCE" ? "Insufficient balance" : message === "ITEM" ? "Item not found" : message === "GAMEPLAY_COSMETIC_FORBIDDEN" ? "Gameplay-affecting cosmetics are not allowed" : "Purchase failed";
    return json({ error }, { status });
  }
}
