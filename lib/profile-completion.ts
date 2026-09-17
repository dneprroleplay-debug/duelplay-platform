export const PROFILE_COMPLETION_REWARD_KEY = "profile-completion-avatar-v1";

export type ProfileCompletionInput = {
  hasCustomAvatar: boolean;
  acceptedFriends: number;
  finishedMatches: number;
  achievements: number;
};

export function calculateProfileCompletion(input: ProfileCompletionInput) {
  const items = [
    { id: "avatar", weight: 25, complete: input.hasCustomAvatar },
    { id: "friends", weight: 25, complete: input.acceptedFriends >= 3 },
    { id: "matches", weight: 25, complete: input.finishedMatches >= 1 },
    { id: "achievement", weight: 25, complete: input.achievements >= 1 },
  ];

  const percent = items.reduce((sum, item) => sum + (item.complete ? item.weight : 0), 0);
  return {
    percent,
    completed: items.filter((item) => item.complete).length,
    total: items.length,
    rewardUnlocked: percent >= 100,
    items,
  };
}
