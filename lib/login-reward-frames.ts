import type { Prisma } from "@prisma/client";

/**
 * The three cosmetic items coupled to the 30-day login reward calendar.
 * Their slugs are persisted in UserLoginReward.reward; do not rename them
 * without a backward-compatible data migration.
 */
export const LOGIN_REWARD_FRAME_CATALOG = [
  {
    slug: "frame-neon-pulse",
    day: 7,
    name: "Неоновый импульс",
    imageUrl: "/images/frames/frame-neon-pulse.svg",
    rarity: "RARE",
    description: "A bright pink neon frame with clean, face-safe edges.",
  },
  {
    slug: "frame-electric-storm",
    day: 15,
    name: "Электрический шторм",
    imageUrl: "/images/frames/frame-electric-storm.svg",
    rarity: "EPIC",
    description: "A violet electric frame with angular lightning accents.",
  },
  {
    slug: "frame-inferno-crown",
    day: 30,
    name: "Inferno Crown",
    imageUrl: "/images/frames/frame-inferno-crown.svg",
    rarity: "MYTHIC",
    description: "A unique ember-gold crown silhouette for the final reward.",
  },
] as const;

export type LoginRewardFrameSlug = (typeof LOGIN_REWARD_FRAME_CATALOG)[number]["slug"];
type Db = Prisma.TransactionClient;

export function loginRewardFrameDefinition(slug: string) {
  return LOGIN_REWARD_FRAME_CATALOG.find((frame) => frame.slug === slug) ?? null;
}

/** Ensure the system cosmetic exists, is active, and has the canonical frame asset. */
export async function ensureLoginRewardFrame(tx: Db, slug: string) {
  const frame = loginRewardFrameDefinition(slug);
  if (!frame) throw new Error("LOGIN_REWARD_FRAME_NOT_CONFIGURED");
  return tx.cosmeticItem.upsert({
    where: { slug: frame.slug },
    create: {
      slug: frame.slug,
      name: frame.name,
      type: "FRAME",
      price: 0,
      imageUrl: frame.imageUrl,
      active: true,
      metadata: {
        source: "HUB",
        sourceLabel: "DuelPlay Hub",
        loginRewardDay: frame.day,
        rarity: frame.rarity,
        description: frame.description,
        nonPayToWin: true,
      },
    },
    update: {
      name: frame.name,
      type: "FRAME",
      price: 0,
      imageUrl: frame.imageUrl,
      active: true,
      metadata: {
        source: "HUB",
        sourceLabel: "DuelPlay Hub",
        loginRewardDay: frame.day,
        rarity: frame.rarity,
        description: frame.description,
        nonPayToWin: true,
      },
    },
  });
}

/** Idempotently repair/create all three catalog items without granting ownership. */
export async function syncLoginRewardFrameCatalog(tx: Db) {
  const items: Array<Awaited<ReturnType<typeof ensureLoginRewardFrame>>> = [];
  for (const frame of LOGIN_REWARD_FRAME_CATALOG) {
    items.push(await ensureLoginRewardFrame(tx, frame.slug));
  }
  return items;
}

/** Grant the frame in the same transaction as the login claim and DEMO ledger entry. */
export async function grantLoginRewardFrame(tx: Db, userId: string, slug: string) {
  const item = await ensureLoginRewardFrame(tx, slug);
  const purchase = await tx.cosmeticPurchase.upsert({
    where: { userId_itemId: { userId, itemId: item.id } },
    create: { userId, itemId: item.id, price: 0 },
    update: {},
  });
  return { item, purchase };
}
