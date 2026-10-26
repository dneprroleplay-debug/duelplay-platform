import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { GAME_MODE_CONFIG_STATE_KEY } from "@/lib/game-mode-config-store";
import { DUEL_MAPS } from "@/lib/duel-maps";
import {
  LEGACY_COMPAT_GAME_MODE_CONFIG,
  buildGameModeAvailability,
  gameModeConfigChecksum,
  validateGameModeConfig,
} from "@/lib/game-mode-config.mjs";

/** Public selector metadata only: never expose unpublished settings or admin data. */
export async function GET() {
  try {
    // This public endpoint must be read-only. In particular, it must not call
    // the lazy active-config initializer, which can create DB rows.
    const state = await prisma.gameModeConfigState.findUnique({
      where: { key: GAME_MODE_CONFIG_STATE_KEY },
      select: { publishedVersion: true },
    });

    let config = LEGACY_COMPAT_GAME_MODE_CONFIG;
    let configVersion = 0;
    if (state?.publishedVersion !== null && state?.publishedVersion !== undefined) {
      const revision = await prisma.gameModeConfigRevision.findUnique({
        where: { version: state.publishedVersion },
        select: { config: true, checksum: true },
      });
      if (!revision) throw new Error("PUBLISHED_GAME_MODE_CONFIG_NOT_FOUND");

      // No verified map-safety profiles are currently registered. Validation
      // therefore refuses any LOW_GRAVITY configuration without guessing limits.
      const normalized = validateGameModeConfig(revision.config, { mapIds: DUEL_MAPS.map(map => map.id), mapSafetyProfiles: {} });
      if (!normalized.ok || gameModeConfigChecksum(normalized.value) !== revision.checksum) {
        throw new Error("PUBLISHED_GAME_MODE_CONFIG_INVALID");
      }
      config = normalized.value;
      configVersion = state.publishedVersion;
    }

    const mapSafetyProfiles: Record<string, { verified: boolean; minimumSafeGravityPercent: number }> = {};
    const maps = buildGameModeAvailability(config, DUEL_MAPS, mapSafetyProfiles);
    return NextResponse.json(
      { ok: true, configVersion, maps },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[PUBLIC_GAME_MODE_AVAILABILITY]", error);
    return NextResponse.json(
      { ok: false, errorCode: "GAME_MODE_AVAILABILITY_UNAVAILABLE", maps: [] },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
