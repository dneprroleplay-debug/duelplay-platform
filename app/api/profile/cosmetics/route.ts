import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";

const SELECT = { id: true, slug: true, name: true, type: true, imageUrl: true, metadata: true } as const;
const EQUIPMENT_FIELDS = { equippedBannerItemId: true, equippedTitleItemId: true } as const;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  const [owned, current] = await Promise.all([
    prisma.cosmeticPurchase.findMany({ where: { userId: user.id, item: { type: { in: ["BANNER", "TITLE"] } } }, include: { item: { select: SELECT } }, orderBy: { createdAt: "asc" } }),
    prisma.user.findUnique({ where: { id: user.id }, select: { ...EQUIPMENT_FIELDS } }),
  ]);
  const items = owned.map(row => ({ ...row.item, imageUrl: row.item.imageUrl || (row.item.slug === "pink-banner" ? "/images/banners/pink-arena-banner.svg" : null), ownedAt: row.createdAt, equipped: row.item.type === "BANNER" ? row.item.id === current?.equippedBannerItemId : row.item.id === current?.equippedTitleItemId }));
  return NextResponse.json({ items, equippedBannerItemId: current?.equippedBannerItemId ?? null, equippedTitleItemId: current?.equippedTitleItemId ?? null }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const type = String(body.type ?? "").toUpperCase();
  const itemId = body.itemId === null ? null : String(body.itemId ?? "");
  if (!["BANNER", "TITLE"].includes(type) || itemId === "") return NextResponse.json({ error: "INVALID_COSMETIC" }, { status: 400 });
  try {
    await prisma.$transaction(async tx => {
      if (itemId) {
        const owned = await tx.cosmeticPurchase.findUnique({ where: { userId_itemId: { userId: user.id, itemId } }, include: { item: { select: { type: true } } } });
        if (!owned || owned.item.type !== type) throw new Error("COSMETIC_NOT_OWNED");
      }
      await tx.user.update({ where: { id: user.id }, data: type === "BANNER" ? { equippedBannerItemId: itemId } : { equippedTitleItemId: itemId } });
    }, { isolationLevel: "Serializable" });
    return NextResponse.json({ ok: true, type, itemId });
  } catch (error) {
    if (error instanceof Error && error.message === "COSMETIC_NOT_OWNED") return NextResponse.json({ error: "COSMETIC_NOT_OWNED" }, { status: 403 });
    throw error;
  }
}
