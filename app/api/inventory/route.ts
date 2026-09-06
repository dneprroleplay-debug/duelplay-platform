import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { creditWallet } from "@/lib/wallet";

const INVENTORY_STATUSES = ["AVAILABLE", "SOLD", "TRADE_PENDING", "TRADE_SENT", "TRADE_ACCEPTED", "TRADE_FAILED"] as const;

type InventoryStatus = (typeof INVENTORY_STATUSES)[number];

function serializeItem(item: { id: string; name: string; imageUrl: string; rarity: string; value: unknown; status: string; createdAt: Date; updatedAt: Date; steamAssetId: string | null }) {
  return {
    id: item.id,
    name: item.name,
    imageUrl: item.imageUrl,
    rarity: item.rarity,
    value: Number(item.value),
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    steamAssetId: item.steamAssetId,
    canSell: item.status === "AVAILABLE",
  };
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Войдите в аккаунт" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const rawLimit = Number(params.get("limit") || 50);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.floor(rawLimit), 1), 100) : 50;
  const rawPage = Number(params.get("page") || 1);
  const page = Number.isFinite(rawPage) ? Math.max(Math.floor(rawPage), 1) : 1;
  const statusParam = params.get("status") || "";
  const rarity = params.get("rarity")?.trim() || "";
  const search = params.get("q")?.trim().slice(0, 80) || "";
  const includeSold = params.get("includeSold") === "true";
  const allowedStatus = statusParam && (INVENTORY_STATUSES as readonly string[]).includes(statusParam) ? statusParam : "";
  const where = {
    userId: user.id,
    ...(allowedStatus ? { status: allowedStatus } : includeSold ? {} : { status: { not: "SOLD" } }),
    ...(rarity ? { rarity } : {}),
    ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
  };

  const [items, total, allStatusRows, availableValue] = await prisma.$transaction([
    prisma.inventoryItem.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit }),
    prisma.inventoryItem.count({ where }),
    prisma.inventoryItem.findMany({ where: { userId: user.id }, select: { status: true } }),
    prisma.inventoryItem.aggregate({ where: { userId: user.id, status: "AVAILABLE" }, _sum: { value: true } }),
  ]);

  const counts = allStatusRows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});

  const pageCount = Math.max(1, Math.ceil(total / limit));

  return NextResponse.json({
    items: items.map(serializeItem),
    counts,
    statuses: INVENTORY_STATUSES,
    stats: { total, page, limit, pageCount, availableValue: Number(availableValue._sum.value || 0) },
    filters: { status: allowedStatus || null, rarity: rarity || null, q: search || null, includeSold },
  }, { headers: { "Cache-Control": "private, no-store" } });
}

/* Legacy response builder retained below for source compatibility. */
/*
  const items = await prisma.inventoryItem.findMany({
    where: { userId: user.id, status: { not: "SOLD" } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const counts = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({
    items: items.map(serializeItem),
    counts,
    statuses: INVENTORY_STATUSES,
  });
}
*/

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  const action = String(body.action || "sell");

  if (!id) return NextResponse.json({ error: "Item required" }, { status: 400 });
  if (action !== "sell") return NextResponse.json({ error: "Unsupported inventory action" }, { status: 400 });

  try {
    const result = await prisma.$transaction(async tx => {
      const saleKey = `inventory:sell:${id}`;
      const previousSale = await tx.transaction.findUnique({
        where: { idempotencyKey: saleKey },
        include: { wallet: { select: { userId: true } } },
      });
      if (previousSale) {
        if (previousSale.wallet.userId !== user.id || previousSale.referenceId !== id || previousSale.type !== "INVENTORY_SALE") {
          throw new Error("IDEMPOTENCY_CONFLICT");
        }
        const soldItem = await tx.inventoryItem.findFirst({ where: { id, userId: user.id, status: "SOLD" } });
        if (!soldItem) throw new Error("ITEM_UNAVAILABLE");
        return {
          balance: Number(previousSale.balanceAfter),
          item: serializeItem(soldItem),
          idempotent: true,
        };
      }

      const item = await tx.inventoryItem.findFirst({
        where: { id, userId: user.id, status: "AVAILABLE" },
      });
      if (!item) throw new Error("ITEM_UNAVAILABLE");

      const changed = await tx.inventoryItem.updateMany({
        where: { id: item.id, userId: user.id, status: "AVAILABLE" },
        data: { status: "SOLD" },
      });
      if (changed.count !== 1) throw new Error("ITEM_UNAVAILABLE");

      const credit = await creditWallet(
        tx,
        user.id,
        Number(item.value),
        saleKey,
        "INVENTORY_SALE",
        `Продажа предмета · ${item.name}`,
        item.id,
      );

      return {
        balance: Number(credit.transaction.balanceAfter),
        item: serializeItem({ ...item, status: "SOLD" }),
        idempotent: credit.idempotent,
      };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "ITEM_UNAVAILABLE") {
      return NextResponse.json({ error: "Предмет уже продан, недоступен или вам не принадлежит" }, { status: 409 });
    }
    if (message === "IDEMPOTENCY_CONFLICT") return NextResponse.json({ error: "Sale idempotency conflict" }, { status: 409 });
    if (message === "INVALID_AMOUNT") return NextResponse.json({ error: "Invalid item value" }, { status: 409 });
    if (message === "WALLET") return NextResponse.json({ error: "Wallet unavailable" }, { status: 409 });
    return NextResponse.json({ error: "Could not sell item" }, { status: 409 });
  }
}
