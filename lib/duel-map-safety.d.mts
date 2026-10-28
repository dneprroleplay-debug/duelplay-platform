export type DuelMapSafetyProfile = {
  mapId: string;
  verified: true;
  minimumSafeGravityPercent: number;
  policyVersion: string;
  verifiedAt: string;
  method: string;
  note: string;
};

export const MINIMUM_SAFE_GRAVITY_PERCENT: number;
export const LOW_GRAVITY_SAFETY_POLICY_VERSION: string;
export const LOW_GRAVITY_SAFETY_VERIFIED_AT: string;
export function getMapSafetyProfiles(): Record<string, DuelMapSafetyProfile>;
export function getMapSafetyProfileList(): DuelMapSafetyProfile[];
export function getMapSafetyProfile(mapId: string): DuelMapSafetyProfile | null;
export function isMapSafetyProfileVerified(mapId: string): boolean;
