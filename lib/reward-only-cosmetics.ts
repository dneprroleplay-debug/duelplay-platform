/** Cosmetics that are earned through progression and must never be sold. */
export const REWARD_ONLY_COSMETIC_SLUGS = [
  "frame-neon-pulse",
  "frame-electric-storm",
  "frame-inferno-crown",
  "frame-profile-complete",
  "frame-level-10",
  "frame-level-20",
  "frame-level-30",
  "frame-level-40",
  "frame-level-50",
  "frame-level-75",
  "frame-level-100",
] as const;

const REWARD_ONLY_SET: ReadonlySet<string> = new Set(REWARD_ONLY_COSMETIC_SLUGS);

export function isRewardOnlyCosmetic(item: { slug: string; metadata?: unknown }): boolean {
  if (REWARD_ONLY_SET.has(item.slug)) return true;
  const metadata = item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
    ? item.metadata as Record<string, unknown>
    : {};
  return metadata.source === "LEVEL"
    || metadata.source === "LOGIN_REWARD"
    || metadata.source === "PROFILE_COMPLETION"
    || metadata.profileCompletionReward === true
    || metadata.rewardOnly === true;
}
