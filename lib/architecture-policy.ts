/**
 * Canonical domain relationship map for the DuelPlay core.
 * Keep cross-domain dependencies explicit so new features do not create
 * parallel user/wallet/match/progression/event/admin state.
 */
export const CORE_DOMAIN_RELATIONSHIPS = {
  identity: ['User', 'UserSession', 'UserDevice'],
  finance: ['Wallet', 'Transaction', 'Deposit', 'Withdrawal'],
  gameplay: ['Game', 'Match', 'MatchPlayerStat', 'GameServer'],
  progression: ['PlayerStats', 'UserAchievement', 'UserMission', 'UserLoginReward'],
  events: ['Event', 'EventPass', 'EventMissionProgress', 'Season', 'DuelPass'],
  administration: ['AuditLog', 'FeatureFlag', 'PlatformSetting', 'WebhookEvent'],
} as const;

export const CORE_SHARED_ENTITIES = ['User', 'Wallet', 'Match', 'PlayerStats', 'Event', 'AuditLog'] as const;
