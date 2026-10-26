export type PublicModeAvailabilityEntry = { available: boolean; reason: string | null };
export type PublicModeAvailabilityByMap = Record<string, Record<string, PublicModeAvailabilityEntry>>;
export const ADVANCED_DUEL_MODE_IDS: readonly ["LOW_GRAVITY", "SPEED_DUEL"];
export function indexPublicGameModeAvailability(payload: unknown): PublicModeAvailabilityByMap | null;
export function loadPublicGameModeAvailability(): Promise<PublicModeAvailabilityByMap | null>;
export function isDuelModeAvailable(availability: PublicModeAvailabilityByMap | null, mapId: string, modeId: string, mapSupported: boolean): boolean;
export function advancedModeAvailabilityHint(language: string, mapModes: Record<string, PublicModeAvailabilityEntry> | null, loaded?: boolean): string;
