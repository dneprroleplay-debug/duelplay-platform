export type GameModeId =
  | "SOLO_1V1"
  | "AWP_ONLY"
  | "DEAGLE_ONLY"
  | "KNIFE_ONLY"
  | "HEADSHOT_ONLY"
  | "RANDOM_WEAPON"
  | "FIRST_TO_10"
  | "GRENADE_ONLY"
  | "LOW_GRAVITY"
  | "SPEED_DUEL";

export type GameModeConfig = {
  schemaVersion: 1;
  modes: Record<GameModeId, {
    enabled: boolean;
    allowedMapIds: string[] | null;
    settings: Record<string, unknown>;
  }>;
};

export const GAME_MODE_IDS: readonly GameModeId[];
export const GAME_MODE_CONFIG_SERVER_NAMES: readonly ["cs2-1", "cs2-2", "cs2-3"];
export const GAME_MODE_CONTROLLER_VERSION: string;
export const REQUIRED_GAME_MODE_CONTROLLER_CAPABILITIES: readonly string[];
export const RANDOM_WEAPON_CATALOG: readonly { weapon: string; slot: string; category: string }[];
export const GRENADE_TYPES: readonly { id: string; classname?: string; terroristClassname?: string; counterTerroristClassname?: string }[];
export const GRAVITY_PERCENT_OPTIONS: readonly number[];
export const SPEED_PERCENT_OPTIONS: readonly number[];
export const DEFAULT_GAME_MODE_CONFIG: GameModeConfig;
export const LEGACY_COMPAT_GAME_MODE_CONFIG: GameModeConfig;

export function validateGameModeConfig(input: unknown, options?: { mapIds?: readonly string[]; mapSafetyProfiles?: Record<string, { verified?: boolean; minimumSafeGravityPercent?: number }> }): { ok: true; value: GameModeConfig; errors?: never } | { ok: false; errors: Array<{ path: string; message: string }>; value?: never };
export function modeIsAvailable(config: GameModeConfig, modeId: GameModeId, mapId: string, mapSupported?: boolean): boolean;
export type GameModeAvailabilityReason = "MAP_UNSUPPORTED" | "SAFETY_PROFILE_REQUIRED" | "MODE_DISABLED" | "MAP_NOT_ALLOWED" | "INVALID_MODE_SETTINGS" | "UNSAFE_GRAVITY_SETTINGS" | "CONFIG_UNAVAILABLE" | null;
export type GameModeAvailabilityEntry = { available: boolean; reason: GameModeAvailabilityReason };
export function buildGameModeAvailability(config: GameModeConfig, mapCatalog: readonly { id: string; serverMapName: string; supportedModes: Partial<Record<GameModeId, boolean>> }[], mapSafetyProfiles?: Record<string, { verified?: boolean; minimumSafeGravityPercent?: number }>): Array<{ mapId: string; serverMapName: string; modes: Record<GameModeId, GameModeAvailabilityEntry> }>;
export function snapshotForMatch(config: GameModeConfig, modeId: GameModeId, mapId: string, version?: number, checksum?: string | null): { schemaVersion: 1; version: number; checksum: string | null; modeId: GameModeId; mapId: string; mode: Record<string, unknown> };
export function extractMatchModeSettings(modeId: string, snapshot: unknown, mapId: string): { gravityPercent?: number; speedPercent?: number };
export function canonicalJson(value: unknown): string;
export function gameModeConfigChecksum(config: unknown): string;
export function allConfigServersAcknowledged(acks: Array<{ serverName: string; checksum: string; status: string; modeControllerVersion?: string | null; capabilities?: string[] | null }>, checksum: string): boolean;
