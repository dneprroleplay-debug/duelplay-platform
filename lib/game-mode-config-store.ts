import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DUEL_MAPS } from "@/lib/duel-maps";
import {
  allConfigServersAcknowledged,
  DEFAULT_GAME_MODE_CONFIG,
  GAME_MODE_CONTROLLER_VERSION,
  GAME_MODE_CONFIG_SERVER_NAMES,
  LEGACY_COMPAT_GAME_MODE_CONFIG,
  REQUIRED_GAME_MODE_CONTROLLER_CAPABILITIES,
  gameModeConfigChecksum,
  modeIsAvailable,
  snapshotForMatch,
  validateGameModeConfig,
  type GameModeConfig,
  type GameModeId,
} from "@/lib/game-mode-config.mjs";

export const GAME_MODE_CONFIG_STATE_KEY = "global";
export { GAME_MODE_CONFIG_SERVER_NAMES };

type ConfigDb = Prisma.TransactionClient | PrismaClient;
type GameModeConfigBundle = {
  state: Prisma.GameModeConfigStateGetPayload<Prisma.GameModeConfigStateDefaultArgs>;
  published: Prisma.GameModeConfigRevisionGetPayload<Prisma.GameModeConfigRevisionDefaultArgs> | null;
  pending: Prisma.GameModeConfigRevisionGetPayload<Prisma.GameModeConfigRevisionDefaultArgs> | null;
  draft: Prisma.GameModeConfigRevisionGetPayload<Prisma.GameModeConfigRevisionDefaultArgs> | null;
  acks: Prisma.GameModeConfigServerAckGetPayload<Prisma.GameModeConfigServerAckDefaultArgs>[];
};
type ActiveGameModeConfig = { version: number; checksum: string; config: GameModeConfig; source: "LEGACY_COMPAT" | "PUBLISHED" };

function mapIds() {
  return DUEL_MAPS.map(map => map.id);
}

export function normalizeGameModeConfig(input: unknown, mapSafetyProfiles: Record<string, { verified?: boolean; minimumSafeGravityPercent?: number }> = {}) {
  return validateGameModeConfig(input, { mapIds: mapIds(), mapSafetyProfiles });
}

/** Lazily seeds the immutable baseline while serialized by a transaction lock. */
export async function ensureGameModeConfigInitialized(tx: ConfigDb) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('duelplay:game-mode-config-state'))`;
  const existing = await tx.gameModeConfigState.findUnique({ where: { key: GAME_MODE_CONFIG_STATE_KEY } });
  if (existing) return existing;

  const normalized = normalizeGameModeConfig(DEFAULT_GAME_MODE_CONFIG);
  if (!normalized.ok) throw new Error(`GAME_MODE_CONFIG_DEFAULT_INVALID:${normalized.errors.map(item => item.path).join(",")}`);
  const checksum = gameModeConfigChecksum(normalized.value);
  const revision = await tx.gameModeConfigRevision.create({
    data: {
      schemaVersion: normalized.value.schemaVersion,
      config: normalized.value as Prisma.InputJsonValue,
      checksum,
      status: "PENDING_SYNC",
    },
  });
  const state = await tx.gameModeConfigState.create({
    data: { key: GAME_MODE_CONFIG_STATE_KEY, pendingVersion: revision.version },
  });
  await tx.gameModeConfigServerAck.createMany({
    data: GAME_MODE_CONFIG_SERVER_NAMES.map(serverName => ({
      revisionVersion: revision.version,
      serverName,
      checksum,
      status: "PENDING" as const,
    })),
  });
  return state;
}

export async function getGameModeConfigBundle(tx?: ConfigDb): Promise<GameModeConfigBundle> {
  if (!tx) return prisma.$transaction(transaction => getGameModeConfigBundle(transaction));
  const state = await ensureGameModeConfigInitialized(tx);
  const [published, pending, draft, acks] = await Promise.all([
    state.publishedVersion === null ? null : tx.gameModeConfigRevision.findUnique({ where: { version: state.publishedVersion } }),
    state.pendingVersion === null ? null : tx.gameModeConfigRevision.findUnique({ where: { version: state.pendingVersion } }),
    state.draftVersion === null ? null : tx.gameModeConfigRevision.findUnique({ where: { version: state.draftVersion } }),
    tx.gameModeConfigServerAck.findMany({
      where: { revisionVersion: state.pendingVersion ?? state.publishedVersion ?? -1 },
      orderBy: { serverName: "asc" },
    }),
  ]);
  return { state, published, pending, draft, acks };
}

export function fullyAcknowledged(acks: Array<{ serverName: string; checksum: string; status: string }>, checksum: string) {
  return allConfigServersAcknowledged(acks, checksum);
}

export async function recordGameModeConfigAck(
  tx: Prisma.TransactionClient,
  input: { version: number; serverName: string; checksum: string; status: "STAGED" | "APPLIED" | "FAILED"; modeControllerVersion?: string | null; capabilities?: string[]; error?: string | null },
) {
  if (!GAME_MODE_CONFIG_SERVER_NAMES.includes(input.serverName as typeof GAME_MODE_CONFIG_SERVER_NAMES[number])) throw new Error("UNKNOWN_CONFIG_SERVER");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('duelplay:game-mode-config-state'))`;
  const state = await ensureGameModeConfigInitialized(tx);
  if (state.pendingVersion !== input.version && state.publishedVersion !== input.version) throw new Error("STALE_CONFIG_VERSION");
  const revision = await tx.gameModeConfigRevision.findUnique({ where: { version: input.version } });
  if (!revision) throw new Error("CONFIG_VERSION_NOT_FOUND");
  if (revision.checksum !== input.checksum) throw new Error("CONFIG_CHECKSUM_MISMATCH");
  if (input.status !== "FAILED") {
    if (input.modeControllerVersion !== GAME_MODE_CONTROLLER_VERSION) throw new Error("MODE_CONTROLLER_VERSION_MISMATCH");
    if (!REQUIRED_GAME_MODE_CONTROLLER_CAPABILITIES.every(capability => input.capabilities?.includes(capability))) throw new Error("MODE_CONTROLLER_CAPABILITIES_MISSING");
  }
  const server = await tx.gameServer.findUnique({ where: { name: input.serverName }, select: { name: true } });
  if (!server) throw new Error("CONFIG_SERVER_NOT_REGISTERED");
  const existingAck = await tx.gameModeConfigServerAck.findUnique({ where: { revisionVersion_serverName: { revisionVersion: input.version, serverName: input.serverName } } });
  const finalStatus = existingAck?.status === "APPLIED" && input.status === "STAGED" ? "APPLIED" : input.status;
  const stagedAt = finalStatus === "FAILED" ? existingAck?.stagedAt ?? null : existingAck?.stagedAt ?? new Date();
  const appliedAt = finalStatus === "APPLIED" ? existingAck?.appliedAt ?? new Date() : existingAck?.appliedAt ?? null;

  await tx.gameModeConfigServerAck.upsert({
    where: { revisionVersion_serverName: { revisionVersion: input.version, serverName: input.serverName } },
    create: {
      revisionVersion: input.version,
      serverName: input.serverName,
      checksum: input.checksum,
      modeControllerVersion: input.modeControllerVersion ?? null,
      capabilities: input.capabilities ? input.capabilities as Prisma.InputJsonValue : Prisma.JsonNull,
      status: finalStatus,
      error: input.error?.slice(0, 500) ?? null,
      stagedAt,
      appliedAt,
    },
    update: {
      checksum: input.checksum,
      modeControllerVersion: input.modeControllerVersion ?? null,
      capabilities: input.capabilities ? input.capabilities as Prisma.InputJsonValue : Prisma.JsonNull,
      status: finalStatus,
      error: input.error?.slice(0, 500) ?? null,
      stagedAt,
      appliedAt,
    },
  });

  if (state.pendingVersion === input.version && (finalStatus === "STAGED" || finalStatus === "APPLIED")) {
    const acknowledgements = await tx.gameModeConfigServerAck.findMany({ where: { revisionVersion: input.version } });
    if (fullyAcknowledged(acknowledgements, revision.checksum)) {
      if (state.publishedVersion !== null) {
        await tx.gameModeConfigRevision.update({ where: { version: state.publishedVersion }, data: { status: "SUPERSEDED" } });
      }
      await tx.gameModeConfigRevision.update({ where: { version: input.version }, data: { status: "PUBLISHED", publishedAt: new Date() } });
      await tx.gameModeConfigState.update({ where: { key: GAME_MODE_CONFIG_STATE_KEY }, data: { publishedVersion: input.version, pendingVersion: null } });
    }
  }
  return { state: await tx.gameModeConfigState.findUniqueOrThrow({ where: { key: GAME_MODE_CONFIG_STATE_KEY } }), revision };
}

export function publishedConfig(revision: { config: Prisma.JsonValue } | null): GameModeConfig | null {
  if (!revision) return null;
  const normalized = normalizeGameModeConfig(revision.config);
  return normalized.ok ? normalized.value : null;
}

export async function getActiveGameModeConfig(tx?: ConfigDb): Promise<ActiveGameModeConfig> {
  if (!tx) return prisma.$transaction(transaction => getActiveGameModeConfig(transaction));
  const bundle = await getGameModeConfigBundle(tx);
  if (!bundle.published) {
    const legacy = normalizeGameModeConfig(LEGACY_COMPAT_GAME_MODE_CONFIG);
    if (!legacy.ok) throw new Error("LEGACY_GAME_MODE_CONFIG_INVALID");
    const checksum = gameModeConfigChecksum(legacy.value);
    return { version: 0, checksum, config: legacy.value, source: "LEGACY_COMPAT" as const };
  }
  const normalized = normalizeGameModeConfig(bundle.published.config);
  if (!normalized.ok || gameModeConfigChecksum(normalized.value) !== bundle.published.checksum) throw new Error("PUBLISHED_GAME_MODE_CONFIG_INVALID");
  return { version: bundle.published.version, checksum: bundle.published.checksum, config: normalized.value, source: "PUBLISHED" as const };
}

export function buildMatchModeConfigSnapshot(active: ActiveGameModeConfig, modeId: GameModeId, mapId: string, mapSupported: boolean) {
  if (!modeIsAvailable(active.config, modeId, mapId, mapSupported)) throw new Error("MODE_CONFIG_NOT_AVAILABLE");
  return snapshotForMatch(active.config, modeId, mapId, active.version, active.checksum);
}
