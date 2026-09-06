import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";

const secrets: Record<string, string | undefined> = {
  discord: process.env.DISCORD_WEBHOOK_SECRET,
  twitch: process.env.TWITCH_WEBHOOK_SECRET,
  telegram: process.env.TELEGRAM_WEBHOOK_SECRET,
  external: process.env.DUELPLAY_WEBHOOK_SECRET,
  "steam-trade": process.env.STEAM_TRADE_WEBHOOK_SECRET,
};
const MAX_PAYLOAD_BYTES = 256 * 1024;
const PROVIDERS = new Set(Object.keys(secrets));

function safeEqualHex(signature: string, expected: string) {
  const normalized = signature.trim().toLowerCase().replace(/^sha256=/, "");
  if (!/^[a-f0-9]{64}$/.test(normalized)) return false;
  return timingSafeEqual(Buffer.from(normalized, "hex"), Buffer.from(expected, "hex"));
}

function getExternalId(request: NextRequest, payload: any) {
  const headerId = request.headers.get("x-event-id") || request.headers.get("x-idempotency-key");
  const payloadId = payload?.id ?? payload?.event_id ?? payload?.eventId ?? null;
  const value = headerId || payloadId;
  return value ? String(value).trim().slice(0, 255) || null : null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  if (!PROVIDERS.has(provider)) return NextResponse.json({ error: "Unknown provider" }, { status: 404 });

  const secret = secrets[provider];
  if (!secret) return NextResponse.json({ error: "Provider not configured" }, { status: 503 });

  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_PAYLOAD_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  const signature = request.headers.get("x-duelplay-signature") || request.headers.get("x-signature") || "";
  const expected = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  if (!safeEqualHex(signature, expected)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const eventType = String(payload.event ?? payload.type ?? "unknown").trim().slice(0, 255) || "unknown";
  const externalId = getExternalId(request, payload);

  try {
    if (externalId) {
      const existing = await prisma.webhookEvent.findUnique({ where: { externalId } });
      if (existing) {
        return NextResponse.json({ ok: true, idempotent: true, id: existing.id });
      }
    }

    const row = await prisma.webhookEvent.create({
      data: {
        provider,
        eventType,
        externalId,
        payload,
        status: "RECEIVED",
      },
    });

    // Steam Trade provider callbacks are applied atomically to both the trade
    // and inventory item. The signed webhook is the only external path allowed
    // to move a trade to SENT/ACCEPTED/FAILED.
    if (provider === "steam-trade") {
      const externalTradeId = String(payload.externalTradeId ?? payload.tradeId ?? payload.id ?? "").trim();
      const status = String(payload.status ?? "").toUpperCase();
      if (!externalTradeId || !["TRADE_SENT", "TRADE_ACCEPTED", "TRADE_FAILED"].includes(status)) {
        await prisma.webhookEvent.update({ where: { id: row.id }, data: { status: "IGNORED", processedAt: new Date() } });
      } else {
        await prisma.$transaction(async tx => {
          const trade = await tx.steamTrade.findUnique({ where: { externalTradeId } });
          if (trade) {
            const allowed =
              (trade.status === "TRADE_PENDING" && status === "TRADE_SENT") ||
              (trade.status === "TRADE_PENDING" && status === "TRADE_FAILED") ||
              (trade.status === "TRADE_SENT" && (status === "TRADE_ACCEPTED" || status === "TRADE_FAILED"));
            if (allowed) {
              await tx.steamTrade.update({ where: { id: trade.id }, data: { status, failureReason: status === "TRADE_FAILED" ? String(payload.reason ?? payload.failureReason ?? "Provider reported failure").slice(0, 255) : null } });
              await tx.inventoryItem.updateMany({ where: { id: trade.inventoryItemId, userId: trade.userId, status: trade.status }, data: { status } });
            }
          }
          await tx.webhookEvent.update({ where: { id: row.id }, data: { status: "PROCESSED", processedAt: new Date() } });
        });
      }
    }

    return NextResponse.json({
      ok: true,
      provider,
      event: eventType,
      id: row.id,
      idempotent: false,
      receivedAt: row.createdAt.toISOString(),
    }, { status: 202 });
  } catch (error: any) {
    // A concurrent delivery can win the unique externalId race. Treat it as the
    // same webhook instead of surfacing a 500 to the provider.
    if (externalId && error?.code === "P2002") {
      const existing = await prisma.webhookEvent.findUnique({ where: { externalId } });
      if (existing) return NextResponse.json({ ok: true, idempotent: true, id: existing.id });
    }
    return NextResponse.json({ error: "Webhook persistence failed" }, { status: 500 });
  }
}
