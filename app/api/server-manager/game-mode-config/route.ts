import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enforceIpRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-meta";
import { GAME_MODE_CONFIG_SERVER_NAMES, getGameModeConfigBundle, normalizeGameModeConfig } from "@/lib/game-mode-config-store";
import { GAME_MODE_CONTROLLER_VERSION, REQUIRED_GAME_MODE_CONTROLLER_CAPABILITIES } from "@/lib/game-mode-config.mjs";
import { DUEL_MAPS } from "@/lib/duel-maps";
import { isServerManagerRequest } from "../auth";

export async function GET(request: NextRequest) {
  try {
    await prisma.$transaction(tx => enforceIpRateLimit(tx, getClientIp(request), "SERVER_MANAGER_MODE_CONFIG", 600, 10 * 60_000));
  } catch (error) {
    if (error instanceof Error && error.message === "RATE_LIMITED") return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    throw error;
  }
  if (!isServerManagerRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const serverName = request.nextUrl.searchParams.get("serverName") || "";
  if (!GAME_MODE_CONFIG_SERVER_NAMES.includes(serverName as typeof GAME_MODE_CONFIG_SERVER_NAMES[number])) {
    return NextResponse.json({ error: "Unknown server", errorCode: "UNKNOWN_CONFIG_SERVER" }, { status: 400 });
  }
  const bundle = await getGameModeConfigBundle();
  const revision = bundle.pending ?? bundle.published;
  if (!revision) return NextResponse.json({ ready: false, reason: "NO_CONFIG_REVISION" }, { status: 503 });
  const mapSafetyProfiles = {};
  const normalized = normalizeGameModeConfig(revision.config, mapSafetyProfiles);
  if (!normalized.ok) return NextResponse.json({ ready: false, reason: "INVALID_PUBLISHED_CONFIG", issues: normalized.errors }, { status: 503 });
  return NextResponse.json({
    ready: true,
    serverName,
    version: revision.version,
    status: revision.status,
    checksum: revision.checksum,
    config: normalized.value,
    mapIds: DUEL_MAPS.map(map => map.id),
    mapSafetyProfiles,
    isPending: bundle.state.pendingVersion === revision.version,
    requiredControllerVersion: GAME_MODE_CONTROLLER_VERSION,
    requiredCapabilities: REQUIRED_GAME_MODE_CONTROLLER_CAPABILITIES,
  }, { headers: { "Cache-Control": "no-store" } });
}
