export const INVENTORY_STATUSES = [
  "AVAILABLE",
  "SOLD",
  "TRADE_PENDING",
  "TRADE_SENT",
  "TRADE_ACCEPTED",
  "TRADE_FAILED",
] as const;

export type InventoryStatus = (typeof INVENTORY_STATUSES)[number];

export function canSellInventoryStatus(status: string): boolean {
  return status === "AVAILABLE";
}

export function canTransitionInventoryStatus(from: string, to: string): boolean {
  if (from === to) return true;
  if (from === "AVAILABLE") return to === "SOLD" || to === "TRADE_PENDING";
  if (from === "TRADE_PENDING") return to === "TRADE_SENT" || to === "TRADE_FAILED";
  if (from === "TRADE_SENT") return to === "TRADE_ACCEPTED" || to === "TRADE_FAILED";
  return false;
}
