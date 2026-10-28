import { Prisma } from "@prisma/client";

export const LEVEL_FRAME_DEFINITIONS = [
  { level: 10, slug: "frame-level-10", name: "Rose Signal", imageUrl: "/images/frames/frame-level-10.svg", rarity: "COMMON", description: "A clean pink outline earned at level 10." },
  { level: 20, slug: "frame-level-20", name: "Pink Circuit", imageUrl: "/images/frames/frame-level-20.svg", rarity: "UNCOMMON", description: "Geometric pink accents earned at level 20." },
  { level: 30, slug: "frame-level-30", name: "Violet Vector", imageUrl: "/images/frames/frame-level-30.svg", rarity: "RARE", description: "Angular violet details earned at level 30." },
  { level: 40, slug: "frame-level-40", name: "Abyssal Prism", imageUrl: "/images/frames/frame-level-40.svg", rarity: "RARE", description: "Layered violet geometry earned at level 40." },
  { level: 50, slug: "frame-level-50", name: "Titanium Rose", imageUrl: "/images/frames/frame-level-50.svg", rarity: "EPIC", description: "Metallic details and restrained gold earned at level 50." },
  { level: 75, slug: "frame-level-75", name: "Sovereign Gold", imageUrl: "/images/frames/frame-level-75.svg", rarity: "LEGENDARY", description: "A refined gold frame earned at level 75." },
  { level: 100, slug: "frame-level-100", name: "Eclipse Ascendant", imageUrl: "/images/frames/frame-level-100.svg", rarity: "MYTHIC", description: "The ultimate eclipse silhouette earned at level 100." },
] as const;

type Db = Prisma.TransactionClient;

/**
 * Idempotently synchronizes the level-frame catalog and grants every frame the
 * player has earned. CosmeticPurchase's unique (userId,itemId) key is the
 * durable ownership guarantee; this never deletes or replaces other rewards.
 */
export async function syncLevelFrames(tx: Db, userId: string, level: number) {
  const safeLevel = Math.max(0, Math.min(100, Math.floor(Number(level) || 0)));
  const result: Array<{ slug: string; level: number; owned: boolean }> = [];
  for (const frame of LEVEL_FRAME_DEFINITIONS) {
    const item = await tx.cosmeticItem.upsert({
      where: { slug: frame.slug },
      create: {
        slug: frame.slug,
        name: frame.name,
        type: "FRAME",
        price: 0,
        imageUrl: frame.imageUrl,
        active: true,
        metadata: { source: "LEVEL", sourceLabel: "Levels", unlockLevel: frame.level, rarity: frame.rarity, description: frame.description, nonPayToWin: true },
      },
      update: {
        name: frame.name,
        type: "FRAME",
        price: 0,
        imageUrl: frame.imageUrl,
        active: true,
        metadata: { source: "LEVEL", sourceLabel: "Levels", unlockLevel: frame.level, rarity: frame.rarity, description: frame.description, nonPayToWin: true },
      },
      select: { id: true },
    });
    let owned = false;
    if (safeLevel >= frame.level) {
      await tx.cosmeticPurchase.upsert({
        where: { userId_itemId: { userId, itemId: item.id } },
        create: { userId, itemId: item.id, price: 0 },
        update: {},
      });
      owned = true;
    } else {
      owned = Boolean(await tx.cosmeticPurchase.findUnique({
        where: { userId_itemId: { userId, itemId: item.id } },
        select: { id: true },
      }));
    }
    result.push({ slug: frame.slug, level: frame.level, owned });
  }
  return result;
}
