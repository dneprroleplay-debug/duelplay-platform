export type DuelMapModeSupport = {
  SOLO_1V1: boolean;
  AWP_ONLY: boolean;
  DEAGLE_ONLY: boolean;
  KNIFE_ONLY: boolean;
  HEADSHOT_ONLY: boolean;
  RANDOM_WEAPON: boolean;
  FIRST_TO_10: boolean;
  GRENADE_ONLY: boolean;
};

export type DuelMapConfig = {
  id: string;
  displayName: string;
  serverMapName: string;
  image: string;
  workshopId?: string;
  category: "AIM" | "CLASSIC" | "ARENA" | "AWP" | "THEMED";
  description: string;
  supportedModes: DuelMapModeSupport;
  requiresManualInstall?: boolean;
};

const ALL_GAMEPLAY = {
  SOLO_1V1: true,
  AWP_ONLY: true,
  DEAGLE_ONLY: true,
  KNIFE_ONLY: true,
  HEADSHOT_ONLY: true,
  RANDOM_WEAPON: true,
  FIRST_TO_10: true,
  GRENADE_ONLY: true,
} as const;

export const DUEL_MAPS: readonly DuelMapConfig[] = [
  {
    id: "aim_redline", displayName: "Aim Redline", serverMapName: "aim_redline",
    image: "/images/maps/aim_redline.png", workshopId: "3162558887", category: "AIM",
    description: "Fast symmetrical aim arena for head-to-head duels.", supportedModes: ALL_GAMEPLAY,
  },
  {
    id: "aim_dust2", displayName: "Aim Dust2", serverMapName: "aim_dust2",
    image: "/images/maps/aim_dust2.png", workshopId: "3297227778", category: "AIM",
    description: "Compact Dust2-style arena built specifically for 1v1.", supportedModes: ALL_GAMEPLAY,
    requiresManualInstall: true,
  },
  {
    id: "pool_day", displayName: "Pool Day (Classic)", serverMapName: "fy_pool_day",
    image: "/images/maps/pool_day_classic.png", workshopId: "3070923343", category: "CLASSIC",
    description: "Classic pool arena with tight sightlines and nostalgic CS gameplay.", supportedModes: ALL_GAMEPLAY,
    requiresManualInstall: true,
  },
  {
    id: "one_v_one_aim_map", displayName: "1v1 Aim Map", serverMapName: "1v1_map",
    image: "/images/maps/one_v_one_aim_map.png", workshopId: "3101654056", category: "AIM",
    description: "Symmetrical arena made for fast 1v1 aim battles.", supportedModes: ALL_GAMEPLAY,
    requiresManualInstall: true,
  },
  {
    id: "one_v_one_remastered", displayName: "1v1 - Remastered", serverMapName: "1v1_remastered",
    image: "/images/maps/one_v_one_remastered.png", workshopId: "3070368330", category: "ARENA",
    description: "Classic 1v1 arena remastered for Counter-Strike 2.", supportedModes: ALL_GAMEPLAY,
    requiresManualInstall: true,
  },
  {
    id: "one_v_one_oasis", displayName: "1v1 Oasis", serverMapName: "1v1_oasis",
    image: "/images/maps/one_v_one_oasis.png", workshopId: "3666490890", category: "THEMED",
    description: "Desert oasis duel arena with a dedicated 1v1 layout.",
    supportedModes: { ...ALL_GAMEPLAY, RANDOM_WEAPON: false },
  },
  {
    id: "one_v_one_v3", displayName: "1v1 v3", serverMapName: "1v1_v3",
    image: "/images/maps/one_v_one_v3.png", workshopId: "3561038663", category: "ARENA",
    description: "Compact 1v1 arena from the current Workshop 1v1 pool.", supportedModes: ALL_GAMEPLAY,
    requiresManualInstall: true,
  },
  {
    id: "one_v_one_arena", displayName: "1v1 Arena", serverMapName: "1v1_arena",
    image: "/images/maps/one_v_one_arena.png", workshopId: "2512669232", category: "ARENA",
    description: "Small symmetrical arena designed for direct duels.", supportedModes: ALL_GAMEPLAY,
    requiresManualInstall: true,
  },
  {
    id: "one_v_one_anubis_aim", displayName: "1v1 Anubis Aim", serverMapName: "1v1_de_anubis_aim",
    image: "/images/maps/one_v_one_anubis_aim.png", workshopId: "3512082348", category: "THEMED",
    description: "Anubis-themed aim arena for short competitive duels.", supportedModes: ALL_GAMEPLAY,
    requiresManualInstall: true,
  },
  {
    id: "aim_halloween_1v1", displayName: "Aim Halloween 1v1", serverMapName: "aim_halloween",
    image: "/images/maps/aim_halloween_1v1.png", workshopId: "3596198331", category: "THEMED",
    description: "Halloween-themed aim arena for a different duel atmosphere.", supportedModes: ALL_GAMEPLAY,
    requiresManualInstall: true,
  },
] as const;

export const DUEL_MAP_IDS = DUEL_MAPS.map((map) => map.id) as string[];

export function getDuelMap(idOrServerName: string | null | undefined) {
  if (!idOrServerName) return null;
  const value = String(idOrServerName);
  return DUEL_MAPS.find((map) => map.id === value || map.serverMapName === value || map.displayName === value) ?? null;
}

export function getDuelMapById(id: string) {
  return DUEL_MAPS.find((map) => map.id === id) ?? null;
}

export function isSupportedDuelMap(idOrServerName: string | null | undefined) {
  return Boolean(getDuelMap(idOrServerName));
}

export function isMapModeSupported(mapIdOrName: string, modeId: keyof DuelMapModeSupport) {
  const map = getDuelMap(mapIdOrName);
  return Boolean(map?.supportedModes[modeId]);
}
