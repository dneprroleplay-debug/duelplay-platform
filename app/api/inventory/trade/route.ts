import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { assertSteamTradeReady, getSteamTradeProvider } from "@/lib/steam-trade";
import { canTransitionInventoryStatus } from "@/lib/inventory-policy";

const TRADE_STATUSES = ["TRADE_PENDING", "TRADE_SENT", "TRADE_ACCEPTED", "TRADE_FAILED"] as const;

type TradeStatus = (typeof TRADE_STATUSES)[number];

function validStatus(value: string): value is TradeStatus {
  return (TRADE_STATUSES as readonly string[]).includes(value);
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const itemId = request.nextUrl.searchParams.get("itemId");
  const trades = await prisma.steamTrade.findMany({
    where: { userId: user.id, ...(itemId ? { inventoryItemId: itemId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ trades });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const itemId = String(body.inventoryItemId || "");
  const steamId = String(body.steamId || user.steamId || "");
  const steamAssetId = String(body.steamAssetId || "");

  if (!itemId || !steamId || !steamAssetId) {
    return NextResponse.json({ error: "Inventory item, SteamID and Steam asset ID are required" }, { status: 400 });
  }
  if (user.steamId && steamId !== user.steamId) {
    return NextResponse.json({ error: "SteamID does not match the authenticated account" }, { status: 403 });
  }

  try {
    assertSteamTradeReady();
  } catch {
    return NextResponse.json({ error: "Steam Trade is not configured" }, { status: 503 });
  }

  try {
    const result = await prisma.$transaction(async tx => {
      const item = await tx.inventoryItem.findFirst({ where: { id: itemId, userId: user.id } });
      if (!item) throw new Error("ITEM_NOT_FOUND");
      if (item.steamAssetId !== steamAssetId) throw new Error("ASSET_MISMATCH");

      const existing = await tx.steamTrade.findUnique({ where: { inventoryItemId: item.id } });
      if (existing) {
        if (existing.userId !== user.id || existing.steamAssetId !== steamAssetId) throw new Error("TRADE_CONFLICT");
        return { trade: existing, idempotent: true };
      }
      if (!canTransitionInventoryStatus(item.status, "TRADE_PENDING")) throw new Error("ITEM_NOT_TRADEABLE");

      await tx.inventoryItem.updateMany({
        where: { id: item.id, userId: user.id, status: "AVAILABLE", steamAssetId: steamAssetId },
        data: { status: "TRADE_PENDING" },
      });

      const trade = await tx.steamTrade.create({
        data: { userId: user.id, inventoryItemId: item.id, steamId, steamAssetId, status: "TRADE_PENDING" },
      });
      await tx.notification.create({ data: { userId: user.id, type: "SYSTEM", status: "UNREAD", title: "Steam Trade создан", body: `Предмет «${item.name}» подготовлен к передаче в Steam.`, payload: { kind: "STEAM_TRADE", tradeId: trade.id, itemId: item.id } } });
      return { trade, idempotent: false };
    });

    if (!result.idempotent && result.trade.status === "TRADE_PENDING") {
      try {
        const provider = getSteamTradeProvider();
        const providerResult = await provider.createTrade({
          inventoryItemId: result.trade.inventoryItemId,
          steamId: result.trade.steamId,
          assetId: result.trade.steamAssetId,
        });
        const updated = await prisma.$transaction(async tx => {
          const current = await tx.steamTrade.findUnique({ where: { id: result.trade.id } });
          if (!current || current.status !== "TRADE_PENDING") return current;
          const nextStatus = providerResult.status === "TRADE_ACCEPTED" ? "TRADE_ACCEPTED" : providerResult.status === "TRADE_FAILED" ? "TRADE_FAILED" : "TRADE_SENT";
          const trade = await tx.steamTrade.update({ where: { id: current.id }, data: { externalTradeId: providerResult.externalTradeId, status: nextStatus, failureReason: nextStatus === "TRADE_FAILED" ? "Provider rejected trade" : null } });
          await tx.inventoryItem.updateMany({ where: { id: current.inventoryItemId, userId: user.id, status: current.status }, data: { status: nextStatus } });
          return trade;
        });
        return NextResponse.json({ ok: true, trade: updated, idempotent: false }, { status: 201 });
      } catch (error) {
        const reason = error instanceof Error ? error.message.slice(0, 255) : "Provider execution failed";
        await prisma.$transaction(async tx => {
          const current = await tx.steamTrade.findUnique({ where: { id: result.trade.id } });
          if (!current || current.status !== "TRADE_PENDING") return;
          await tx.steamTrade.update({ where: { id: current.id }, data: { status: "TRADE_FAILED", failureReason: reason } });
          await tx.inventoryItem.updateMany({ where: { id: current.inventoryItemId, userId: user.id, status: "TRADE_PENDING" }, data: { status: "TRADE_FAILED" } });
        });
        return NextResponse.json({ error: "Steam Trade provider failed", errorCode: "TRADE_PROVIDER_FAILED" }, { status: 502 });
      }
    }
    return NextResponse.json({ ok: true, ...result }, { status: result.idempotent ? 200 : 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "ITEM_NOT_FOUND") return NextResponse.json({ error: "Item not found" }, { status: 404 });
    if (message === "ASSET_MISMATCH") return NextResponse.json({ error: "Steam asset ID does not match inventory" }, { status: 409 });
    if (message === "ITEM_NOT_TRADEABLE") return NextResponse.json({ error: "Item is not available for Steam Trade" }, { status: 409 });
    if (message === "TRADE_CONFLICT") return NextResponse.json({ error: "Steam Trade conflict" }, { status: 409 });
    return NextResponse.json({ error: "Could not create Steam Trade" }, { status: 409 });
  }
}

export async function PATCH(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const tradeId = String(body.tradeId || "");
  const status = String(body.status || "");
  if (!tradeId || !validStatus(status)) return NextResponse.json({ error: "Invalid trade update" }, { status: 400 });

  // Provider callbacks must use the webhook boundary instead of allowing clients to forge final trade states.
  if (status === "TRADE_ACCEPTED" || status === "TRADE_SENT") {
    return NextResponse.json({ error: "Trade status is provider-controlled" }, { status: 403 });
  }
  if (status !== "TRADE_FAILED") return NextResponse.json({ error: "Unsupported trade transition" }, { status: 400 });

  try {
    const trade = await prisma.$transaction(async tx => {
      const current = await tx.steamTrade.findFirst({ where: { id: tradeId, userId: user.id } });
      if (!current) throw new Error("TRADE_NOT_FOUND");
      if (current.status === "TRADE_FAILED") return current;
      if (!canTransitionInventoryStatus(current.status, "TRADE_FAILED")) throw new Error("INVALID_TRANSITION");
      await tx.steamTrade.update({ where: { id: current.id }, data: { status: "TRADE_FAILED", failureReason: "Cancelled before provider execution" } });
      await tx.inventoryItem.updateMany({ where: { id: current.inventoryItemId, userId: user.id, status: current.status }, data: { status: "TRADE_FAILED" } });
      return tx.steamTrade.findUniqueOrThrow({ where: { id: current.id } });
    });
    return NextResponse.json({ ok: true, trade });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "TRADE_NOT_FOUND") return NextResponse.json({ error: "Trade not found" }, { status: 404 });
    if (message === "INVALID_TRANSITION") return NextResponse.json({ error: "Invalid trade transition" }, { status: 409 });
    return NextResponse.json({ error: "Could not update Steam Trade" }, { status: 409 });
  }
}
