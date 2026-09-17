export const CLAN_WAR_STATUSES = ["PENDING", "ACTIVE", "FINISHED", "CANCELLED"] as const;
export type ClanWarStatus = (typeof CLAN_WAR_STATUSES)[number];
export const CLAN_WAR_RATING_WIN = 25;
export const CLAN_WAR_RATING_LOSS = 25;

export function isClanWarStatus(value: string): value is ClanWarStatus {
  return (CLAN_WAR_STATUSES as readonly string[]).includes(value);
}

export function canFinishClanWar(status: string) {
  return status === "ACTIVE";
}

export function nextClanWarStatus(action: "start" | "finish" | "cancel", status: string): ClanWarStatus | null {
  if (action === "start" && status === "PENDING") return "ACTIVE";
  if (action === "finish" && status === "ACTIVE") return "FINISHED";
  if (action === "cancel" && (status === "PENDING" || status === "ACTIVE")) return "CANCELLED";
  return null;
}
