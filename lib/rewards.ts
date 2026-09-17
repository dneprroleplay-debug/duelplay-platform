import { Prisma } from "@prisma/client";
import { randomInt } from "node:crypto";
import { creditWallet } from "@/lib/wallet";
import { awardXp } from "@/lib/progression";
import { assertNonGameplayReward } from "@/lib/monetization-policy";

type Tx = Prisma.TransactionClient;

type Reward = Record<string, unknown>;

export async function grantReward(tx: Tx, userId: string, rewardInput: unknown, idempotencyKey: string, description: string, referenceId?: string) {
  assertNonGameplayReward(rewardInput);
  const reward: Reward = rewardInput && typeof rewardInput === "object" ? rewardInput as Reward : {};
  const existingGrant = await tx.rewardGrant.findUnique({ where: { idempotencyKey } });
  if (existingGrant) return { xp: 0, balance: 0, balanceAfter: null, inventoryItemId: null, idempotent: true };
  await tx.rewardGrant.create({ data: { userId, idempotencyKey, description, referenceId } });
  const xp = Math.max(0, Math.floor(Number(reward.xp ?? 0)));
  const balance = Math.max(0, Number(reward.balance ?? reward.coins ?? 0));
  if (xp > 0) await awardXp(tx, userId, xp);

  let balanceAfter: number | null = null;
  if (balance > 0) {
    const c = await creditWallet(tx, userId, balance, idempotencyKey, "BONUS", description, referenceId);
    balanceAfter = Number(c.transaction.balanceAfter);
  }

  const caseRequested = Boolean(reward.case || reward.caseId || reward.caseSlug);
  const cosmeticRequested = Boolean(reward.cosmetic || reward.cosmeticItemId);
  let inventoryItemId: string | null = null;

  if (caseRequested) {
    const where = reward.caseId ? { id: String(reward.caseId) } : reward.caseSlug ? { slug: String(reward.caseSlug) } : undefined;
    const box = await tx.duelCase.findFirst({ where: where || { active: true }, include: { items: true } });
    let item = box?.items[0];
    if (box && box.items.length) {
      const totalWeight = box.items.reduce((sum, candidate) => sum + Math.max(0, Number(candidate.weight)), 0);
      if (totalWeight > 0) {
        const roll = randomInt(1, Math.floor(totalWeight) + 1);
        let cursor = 0;
        for (const candidate of box.items) {
          cursor += Math.max(0, Number(candidate.weight));
          if (roll <= cursor) { item = candidate; break; }
        }
      }
    }
    if (item && box) {
      const created = await tx.inventoryItem.create({ data: { userId, caseId: box.id, caseItemId: item.id, name: item.name, imageUrl: item.imageUrl, rarity: item.rarity, value: item.value, status: "AVAILABLE" } });
      inventoryItemId = created.id;
    }
  }

  if (cosmeticRequested) {
    const item = await tx.cosmeticItem.findFirst({ where: reward.cosmeticItemId ? { id: String(reward.cosmeticItemId), active: true } : { active: true }, orderBy: { price: "asc" } });
    if (item) {
      const owned = await tx.cosmeticPurchase.findUnique({ where: { userId_itemId: { userId, itemId: item.id } } });
      if (!owned) await tx.cosmeticPurchase.create({ data: { userId, itemId: item.id, price: 0 } });
    }
  }

  return { xp, balance, balanceAfter, inventoryItemId, idempotent: false };
}
