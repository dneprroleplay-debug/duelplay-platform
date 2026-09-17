export const CLAN_MAX_MEMBERS = 20;
export const CLAN_MIN_NAME_LENGTH = 2;
export const CLAN_MAX_NAME_LENGTH = 24;
export const CLAN_MIN_TAG_LENGTH = 2;
export const CLAN_MAX_TAG_LENGTH = 6;

export function clanRankSort(a: { rating: number; wins: number; createdAt: Date | string }, b: { rating: number; wins: number; createdAt: Date | string }) {
  return b.rating - a.rating || b.wins - a.wins || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

export function canManageClan(role: "LEADER" | "OFFICER" | "MEMBER", targetRole?: "LEADER" | "OFFICER" | "MEMBER") {
  if (role === "LEADER") return true;
  return role === "OFFICER" && targetRole !== "LEADER" && targetRole !== "OFFICER";
}
