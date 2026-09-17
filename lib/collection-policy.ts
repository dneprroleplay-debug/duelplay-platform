export type CollectionRequirement = { name: string; quantity: number };

export const MAX_COLLECTION_REQUIREMENTS = 50;
export const MAX_COLLECTION_ITEM_NAME = 120;
export const MAX_COLLECTION_ITEM_QUANTITY = 100;

export function validateCollectionRequirements(value: unknown): CollectionRequirement[] {
  const normalized = normalizeCollectionRequirements(value);
  if (!normalized.length || normalized.length > MAX_COLLECTION_REQUIREMENTS) throw new Error("INVALID_REQUIREMENTS");
  for (const requirement of normalized) {
    if (requirement.name.length > MAX_COLLECTION_ITEM_NAME || requirement.quantity < 1 || requirement.quantity > MAX_COLLECTION_ITEM_QUANTITY) {
      throw new Error("INVALID_REQUIREMENTS");
    }
  }
  return normalized;
}

export function normalizeCollectionRequirements(value: unknown): CollectionRequirement[] {
  const raw = Array.isArray(value) ? value : value && typeof value === "object" ? ((value as Record<string, unknown>).items ?? (value as Record<string, unknown>).requirements ?? []) : [];
  if (!Array.isArray(raw)) return [];
  const merged = new Map<string, number>();
  for (const entry of raw) {
    const name = typeof entry === "string" ? entry.trim() : entry && typeof entry === "object" ? String((entry as Record<string, unknown>).name ?? (entry as Record<string, unknown>).itemName ?? "").trim() : "";
    const quantity = typeof entry === "object" && entry ? Math.max(1, Math.floor(Number((entry as Record<string, unknown>).quantity ?? 1))) : 1;
    if (name) merged.set(name, (merged.get(name) ?? 0) + quantity);
  }
  return [...merged.entries()].map(([name, quantity]) => ({ name, quantity }));
}

export function collectionProgress(requirements: CollectionRequirement[], ownedNames: string[]) {
  const counts = new Map<string, number>();
  for (const name of ownedNames) counts.set(name, (counts.get(name) ?? 0) + 1);
  const matched = requirements.reduce((sum, req) => sum + Math.min(req.quantity, counts.get(req.name) ?? 0), 0);
  const total = requirements.reduce((sum, req) => sum + req.quantity, 0);
  return { matched, total, progress: total ? matched / total : 0, completed: total > 0 && matched >= total, remaining: Math.max(0, total - matched) };
}
