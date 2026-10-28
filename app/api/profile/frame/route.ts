import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { syncLoginRewardFrameCatalog } from "@/lib/login-reward-frames";
import { cosmeticFrameImageUrl } from "@/lib/cosmetic-frame-image";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  const currentUser = await prisma.user.findUnique({ where: { id: user.id }, select: { level: true, equippedFrameItemId: true } });
  if (!currentUser) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  // Backfill all earned level rewards for older accounts and expose locked
  // collection entries without granting ownership prematurely.
  const { syncLevelFrames } = await import("@/lib/level-frames");
  // Keep the existing serializable level-reward transaction independent from
  // the small catalog repair transaction used by the login-reward endpoint.
  await prisma.$transaction(async (tx) => {
    await syncLoginRewardFrameCatalog(tx);
  });
  await prisma.$transaction(async (tx) => {
    await syncLevelFrames(tx, user.id, currentUser.level);
  }, { isolationLevel: "Serializable" });

  const [owned, levelCatalog] = await Promise.all([
    prisma.cosmeticPurchase.findMany({
      where: { userId: user.id, item: { type: "FRAME" } },
      include: { item: { select: { id: true, slug: true, name: true, imageUrl: true, metadata: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.cosmeticItem.findMany({
      where: { type: "FRAME", slug: { in: ["frame-level-10", "frame-level-20", "frame-level-30", "frame-level-40", "frame-level-50", "frame-level-75", "frame-level-100"] } },
      select: { id: true, slug: true, name: true, imageUrl: true, metadata: true },
    }),
  ]);
  const ownedById = new Map(owned.map((row) => [row.item.id, row]));
  const allItems = new Map<string, { id: string; slug: string; name: string; imageUrl: string | null; metadata: unknown; ownedAt?: Date }>();
  for (const row of owned) allItems.set(row.item.id, { ...row.item, ownedAt: row.createdAt });
  for (const item of levelCatalog) if (!allItems.has(item.id)) allItems.set(item.id, item);

  const frames = [...allItems.values()].map((item) => {
    const metadata = item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
      ? item.metadata as Record<string, unknown> : {};
    const purchase = ownedById.get(item.id);
    const unlockLevel = typeof metadata.unlockLevel === "number" ? metadata.unlockLevel : null;
    return {
      ...item,
      imageUrl: cosmeticFrameImageUrl(item.slug, item.imageUrl),
      owned: Boolean(purchase),
      ownedAt: purchase?.createdAt ?? null,
      source: typeof metadata.source === "string" ? metadata.source : item.slug === "frame-profile-complete" ? "PROFILE_COMPLETION" : ["frame-neon-pulse", "frame-electric-storm", "frame-inferno-crown"].includes(item.slug) ? "HUB" : "OTHER",
      unlockLevel,
      playerLevel: currentUser.level,
      equipped: Boolean(purchase && item.id === currentUser.equippedFrameItemId),
      locked: unlockLevel !== null && currentUser.level < unlockLevel && !purchase,
    };
  }).sort((a, b) => {
    const al = a.unlockLevel ?? -1;
    const bl = b.unlockLevel ?? -1;
    if (al !== bl) return al - bl;
    return a.name.localeCompare(b.name);
  });
  return NextResponse.json({ frames, equippedFrameItemId: currentUser.equippedFrameItemId ?? null, playerLevel: currentUser.level }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const itemId = body.itemId === null ? null : String(body.itemId ?? "");
  if (itemId === "") return NextResponse.json({ error: "INVALID_FRAME" }, { status: 400 });
  try {
    await prisma.$transaction(async (tx) => {
      if (itemId) {
        const owned = await tx.cosmeticPurchase.findUnique({ where: { userId_itemId: { userId: user.id, itemId } }, include: { item: { select: { type: true } } } });
        if (!owned || owned.item.type !== "FRAME") throw new Error("FRAME_NOT_OWNED");
      }
      await tx.user.update({ where: { id: user.id }, data: { equippedFrameItemId: itemId } });
    }, { isolationLevel: "Serializable" });
    return NextResponse.json({ ok: true, equippedFrameItemId: itemId });
  } catch (error) {
    if (error instanceof Error && error.message === "FRAME_NOT_OWNED") return NextResponse.json({ error: "FRAME_NOT_OWNED" }, { status: 403 });
    throw error;
  }
}
