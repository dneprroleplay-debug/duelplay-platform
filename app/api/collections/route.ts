import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { grantReward } from "@/lib/rewards";
import { normalizeCollectionRequirements, validateCollectionRequirements, collectionProgress } from "@/lib/collection-policy";

function collectionView(
  collection: { id: string; name: string; description: string | null; requirements: unknown; reward: unknown; active: boolean },
  inventory: Array<{ name: string; status: string }>,
  claimedAt: Date | null
) {
  const requirements = normalizeCollectionRequirements(collection.requirements);
  const progress = collectionProgress(requirements, inventory.filter(i => i.status !== "SOLD").map(i => i.name));
  return {
    id: collection.id, name: collection.name, description: collection.description, requirements, reward: collection.reward,
    matched: progress.matched, totalRequired: progress.total, remaining: progress.remaining, progress: progress.progress, completed: progress.completed,
    claimed: Boolean(claimedAt), claimedAt: claimedAt ? claimedAt.toISOString() : null,
  };
}

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [collections, inventory, claims] = await Promise.all([
    prisma.collection.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.inventoryItem.findMany({ where: { userId: me.id }, select: { name: true, status: true } }),
    prisma.collectionClaim.findMany({ where: { userId: me.id }, select: { collectionId: true, claimedAt: true } }),
  ]);
  const claimed = new Map(claims.map(c => [c.collectionId, c.claimedAt]));
  return NextResponse.json(collections.map(c => collectionView(c, inventory, claimed.get(c.id) ?? null)));
}

export async function POST(request: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const collectionId = String(body.collectionId || "");
  const rawIdem = String(request.headers.get("idempotency-key") || body.idempotencyKey || "");
  const idem = rawIdem ? rawIdem.slice(0, 200) : `collection:${collectionId}`;
  if (!collectionId) return NextResponse.json({ error: "Collection required" }, { status: 400 });
  try {
    const result = await prisma.$transaction(async tx => {
      const collection = await tx.collection.findFirst({ where: { id: collectionId, active: true } });
      if (!collection) throw new Error("COLLECTION");
      const existing = await tx.collectionClaim.findUnique({ where: { userId_collectionId: { userId: me.id, collectionId } } });
      if (existing) return { idempotent: true, claimedAt: existing.claimedAt, balance: null, reward: null };

      const inventory = await tx.inventoryItem.findMany({ where: { userId: me.id, status: { not: "SOLD" } }, select: { name: true, status: true } });
      const requirements = validateCollectionRequirements(collection.requirements);
      const progress = collectionProgress(requirements, inventory.map(i => i.name));
      if (!progress.completed) throw new Error("INCOMPLETE");

      if (!collection.reward || typeof collection.reward !== "object" || Array.isArray(collection.reward)) throw new Error("REWARD");
      const claim = await tx.collectionClaim.create({ data: { userId: me.id, collectionId } });
      const rewardKey = `collection:${me.id}:${collection.id}:${idem}`;
      const reward = collection.reward && typeof collection.reward === "object" ? collection.reward as Record<string, unknown> : {};
      const granted = await grantReward(tx, me.id, reward, rewardKey, `Collection reward · ${collection.name}`, collection.id);
      return { idempotent: false, claim, balance: granted.balanceAfter, reward: granted };
    }, { isolationLevel: "Serializable" });
    return NextResponse.json({ ok: true, ...result }, { status: result.idempotent ? 200 : 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    if (message === "COLLECTION") return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    if (message === "INCOMPLETE") return NextResponse.json({ error: "Collection is not completed" }, { status: 409 });
    if (message === "REWARD") return NextResponse.json({ error: "Collection reward is not configured" }, { status: 409 });
    if (message.toLowerCase().includes("serializable") || message.includes("P2034")) return NextResponse.json({ error: "Collection is being claimed, please retry" }, { status: 409 });
    console.error(e); return NextResponse.json({ error: "Could not claim collection" }, { status: 500 });
  }
}
