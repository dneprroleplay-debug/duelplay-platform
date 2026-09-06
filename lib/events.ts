export const EVENT_STATUSES = ["DRAFT", "SCHEDULED", "ACTIVE", "ENDED", "CANCELLED"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export function validateEventWindow(startsAt: Date, endsAt: Date) {
  return Number.isFinite(startsAt.getTime()) && Number.isFinite(endsAt.getTime()) && endsAt > startsAt;
}

export function effectiveEventStatus(status: EventStatus, startsAt: Date, endsAt: Date, now = new Date()): EventStatus {
  if (status === "CANCELLED" || status === "DRAFT") return status;
  if (endsAt <= now) return "ENDED";
  if (startsAt <= now) return "ACTIVE";
  return "SCHEDULED";
}

export function validateEventPayload(input: Record<string, unknown>) {
  const name = String(input.name ?? "").trim();
  const startsAt = new Date(String(input.startsAt ?? ""));
  const endsAt = new Date(String(input.endsAt ?? ""));
  const premiumPrice = Number(input.premiumPrice ?? 0);
  const promoMultiplier = Number(input.promoMultiplier ?? 1);
  if (!name || name.length > 120) throw new Error("INVALID_NAME");
  if (!validateEventWindow(startsAt, endsAt)) throw new Error("INVALID_DATES");
  if (!Number.isFinite(premiumPrice) || premiumPrice < 0) throw new Error("INVALID_PREMIUM_PRICE");
  if (!Number.isFinite(promoMultiplier) || promoMultiplier < 1 || promoMultiplier > 100) throw new Error("INVALID_MULTIPLIER");
  if (input.premiumPass === true && premiumPrice > 0 && input.eventPass !== true) throw new Error("PREMIUM_REQUIRES_PASS");
  return { name, startsAt, endsAt, premiumPrice, promoMultiplier };
}

export function safeJson(value: unknown, maxBytes = 200_000) {
  if (value === undefined || value === null) return null;
  let encoded = "";
  try { encoded = JSON.stringify(value); } catch { throw new Error("INVALID_JSON"); }
  if (!encoded || Buffer.byteLength(encoded, "utf8") > maxBytes) throw new Error("JSON_TOO_LARGE");
  return value as any;
}

export function validateEventConfig(input: Record<string, unknown>) {
  for (const key of ["effects", "missions", "rewards", "leaderboard"]) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "object") throw new Error("INVALID_CONFIG");
  }
  if (input.missions !== undefined && input.missions !== null && !Array.isArray(input.missions)) throw new Error("INVALID_MISSIONS");
  if (input.rewards !== undefined && input.rewards !== null && !Array.isArray(input.rewards)) throw new Error("INVALID_REWARDS");
  return true;
}
