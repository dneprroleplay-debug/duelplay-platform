import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auditRequest } from "@/lib/admin";
import { requireGameModeAdmin } from "../../../../lib/admin-rbac";
import { GAME_MODE_CONFIG_SERVER_NAMES, ensureGameModeConfigInitialized, getGameModeConfigBundle, normalizeGameModeConfig } from "@/lib/game-mode-config-store";
import { GRENADE_TYPES, RANDOM_WEAPON_CATALOG, gameModeConfigChecksum } from "@/lib/game-mode-config.mjs";
import { DUEL_MAPS } from "@/lib/duel-maps";
import { getMapSafetyProfileList } from "@/lib/duel-map-safety.mjs";

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "ADMIN_LOGIN_REQUIRED") return NextResponse.json({ error: "Требуется вход администратора", errorCode: code }, { status: 401 });
  if (code.startsWith("ADMIN_MFA_")) return NextResponse.json({ error: "Требуется подтверждение MFA администратора", errorCode: code }, { status: 403 });
  if (code === "FORBIDDEN") return NextResponse.json({ error: "Доступ к настройкам игровых режимов запрещён", errorCode: code }, { status: 403 });
  console.error("[GAME_MODE_CONFIG_ADMIN]", error);
  return NextResponse.json({ error: "Не удалось обработать конфигурацию режимов", errorCode: code || "GAME_MODE_CONFIG_ERROR" }, { status: 500 });
}

async function ensureRegisteredServerGroup(tx: Prisma.TransactionClient) {
  const rows = await tx.gameServer.findMany({ where: { name: { in: [...GAME_MODE_CONFIG_SERVER_NAMES] } }, select: { name: true, metadata: true } });
  const names = new Set(rows.map(row => row.name));
  const missing = GAME_MODE_CONFIG_SERVER_NAMES.filter(name => !names.has(name));
  if (missing.length) throw new Error(`MODE_CONFIG_SERVERS_NOT_REGISTERED:${missing.join(",")}`);
  return rows;
}

async function createPendingRevision(tx: Prisma.TransactionClient, input: {
  config: Prisma.InputJsonValue;
  checksum: string;
  createdById: string;
  rollbackOfVersion?: number | null;
}) {
  const revision = await tx.gameModeConfigRevision.create({
    data: {
      config: input.config,
      checksum: input.checksum,
      status: "PENDING_SYNC",
      createdById: input.createdById,
      rollbackOfVersion: input.rollbackOfVersion ?? null,
    },
  });
  await tx.gameModeConfigServerAck.createMany({
    data: GAME_MODE_CONFIG_SERVER_NAMES.map(serverName => ({
      revisionVersion: revision.version,
      serverName,
      checksum: input.checksum,
      status: "PENDING" as const,
    })),
  });
  return revision;
}

export async function GET() {
  try {
    const access = await requireGameModeAdmin();
    const [bundle, history, registered] = await Promise.all([
      getGameModeConfigBundle(),
      prisma.gameModeConfigRevision.findMany({ orderBy: { version: "desc" }, take: 30, select: { version: true, status: true, checksum: true, createdById: true, createdAt: true, publishedAt: true, rollbackOfVersion: true } }),
      prisma.gameServer.findMany({ where: { name: { in: [...GAME_MODE_CONFIG_SERVER_NAMES] } }, select: { name: true, status: true, lastHeartbeat: true, metadata: true } }),
    ]);
    return NextResponse.json({
      me: { roleCode: access.roleCode, level: access.level },
      state: { publishedVersion: bundle.state.publishedVersion, pendingVersion: bundle.state.pendingVersion, draftVersion: bundle.state.draftVersion },
      published: bundle.published,
      pending: bundle.pending,
      draft: bundle.draft,
      acknowledgements: bundle.acks,
      servers: registered,
      requiredServers: GAME_MODE_CONFIG_SERVER_NAMES,
      mapCatalog: DUEL_MAPS.map(map => ({ id: map.id, displayName: map.displayName, serverMapName: map.serverMapName })),
      mapSafetyProfiles: getMapSafetyProfileList(),
      weaponCatalog: RANDOM_WEAPON_CATALOG,
      grenadeCatalog: GRENADE_TYPES,
      history,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  let access: Awaited<ReturnType<typeof requireGameModeAdmin>>;
  try { access = await requireGameModeAdmin(); }
  catch (error) { return errorResponse(error); }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NextResponse.json({ error: "Некорректный запрос", errorCode: "INVALID_BODY" }, { status: 400 });
    body = parsed as Record<string, unknown>;
  } catch { return NextResponse.json({ error: "Некорректный JSON", errorCode: "INVALID_JSON" }, { status: 400 }); }

  const action = String(body.action ?? "");
  if (!["validate", "saveDraft", "publishDraft", "rollback"].includes(action)) return NextResponse.json({ error: "Неизвестное действие", errorCode: "INVALID_ACTION" }, { status: 400 });

  try {
    if (action === "validate" || action === "saveDraft") {
      const normalized = normalizeGameModeConfig(body.config);
      if (!normalized.ok) return NextResponse.json({ error: "Настройки не прошли валидацию", errorCode: "INVALID_GAME_MODE_CONFIG", issues: normalized.errors }, { status: 400 });
      if (action === "validate") return NextResponse.json({ ok: true, config: normalized.value, checksum: gameModeConfigChecksum(normalized.value) });

      const result = await prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('duelplay:game-mode-config-state'))`;
        const state = await ensureGameModeConfigInitialized(tx);
        if (state.draftVersion !== null) await tx.gameModeConfigRevision.update({ where: { version: state.draftVersion }, data: { status: "SUPERSEDED" } });
        const checksum = gameModeConfigChecksum(normalized.value);
        const draft = await tx.gameModeConfigRevision.create({ data: { config: normalized.value as Prisma.InputJsonValue, checksum, status: "DRAFT", createdById: access.user.id } });
        await tx.gameModeConfigState.update({ where: { key: state.key }, data: { draftVersion: draft.version } });
        return draft;
      });
      await auditRequest(request, access.user.id, "SAVE_GAME_MODE_CONFIG_DRAFT", "GAME_MODE_CONFIG", String(result.version), { checksum: result.checksum, schemaVersion: result.schemaVersion });
      return NextResponse.json({ ok: true, draft: result }, { status: 201 });
    }

    if (action === "publishDraft") {
      const result = await prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('duelplay:game-mode-config-state'))`;
        const state = await ensureGameModeConfigInitialized(tx);
        if (state.pendingVersion !== null) throw new Error("MODE_CONFIG_SYNC_IN_PROGRESS");
        if (state.draftVersion === null) throw new Error("MODE_CONFIG_DRAFT_REQUIRED");
        await ensureRegisteredServerGroup(tx);
        const draft = await tx.gameModeConfigRevision.findUnique({ where: { version: state.draftVersion } });
        if (!draft || draft.status !== "DRAFT") throw new Error("MODE_CONFIG_DRAFT_REQUIRED");
        const normalized = normalizeGameModeConfig(draft.config);
        if (!normalized.ok) throw new Error("MODE_CONFIG_DRAFT_INVALID");
        const pending = await createPendingRevision(tx, { config: normalized.value as Prisma.InputJsonValue, checksum: gameModeConfigChecksum(normalized.value), createdById: access.user.id });
        await tx.gameModeConfigRevision.update({ where: { version: draft.version }, data: { status: "SUPERSEDED" } });
        await tx.gameModeConfigState.update({ where: { key: state.key }, data: { draftVersion: null, pendingVersion: pending.version } });
        return pending;
      });
      await auditRequest(request, access.user.id, "PUBLISH_GAME_MODE_CONFIG", "GAME_MODE_CONFIG", String(result.version), { checksum: result.checksum });
      return NextResponse.json({ ok: true, pending: result, message: "Публикация ожидает подтверждения всех трёх CS2-серверов." }, { status: 202 });
    }

    const rollbackVersion = Number(body.version);
    if (!Number.isInteger(rollbackVersion) || rollbackVersion < 1) return NextResponse.json({ error: "Укажите корректную версию для отката", errorCode: "INVALID_ROLLBACK_VERSION" }, { status: 400 });
    const result = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('duelplay:game-mode-config-state'))`;
      const state = await ensureGameModeConfigInitialized(tx);
      if (state.pendingVersion !== null) throw new Error("MODE_CONFIG_SYNC_IN_PROGRESS");
      await ensureRegisteredServerGroup(tx);
      const source = await tx.gameModeConfigRevision.findUnique({ where: { version: rollbackVersion } });
      if (!source || !["PUBLISHED", "SUPERSEDED"].includes(source.status)) throw new Error("MODE_CONFIG_ROLLBACK_NOT_FOUND");
      const normalized = normalizeGameModeConfig(source.config);
      if (!normalized.ok) throw new Error("MODE_CONFIG_ROLLBACK_INVALID");
      const checksum = gameModeConfigChecksum(normalized.value);
      const pending = await createPendingRevision(tx, { config: normalized.value as Prisma.InputJsonValue, checksum, createdById: access.user.id, rollbackOfVersion: source.version });
      await tx.gameModeConfigState.update({ where: { key: state.key }, data: { draftVersion: null, pendingVersion: pending.version } });
      return pending;
    });
    await auditRequest(request, access.user.id, "ROLLBACK_GAME_MODE_CONFIG", "GAME_MODE_CONFIG", String(result.version), { rollbackOfVersion: rollbackVersion, checksum: result.checksum });
    return NextResponse.json({ ok: true, pending: result, message: "Откат ожидает подтверждения всех трёх CS2-серверов." }, { status: 202 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "MODE_CONFIG_SYNC_IN_PROGRESS") return NextResponse.json({ error: "Предыдущая версия ещё синхронизируется на всех серверах", errorCode: code }, { status: 409 });
    if (code === "MODE_CONFIG_DRAFT_REQUIRED") return NextResponse.json({ error: "Сначала сохраните проверенный черновик", errorCode: code }, { status: 409 });
    if (code.startsWith("MODE_CONFIG_DRAFT_INVALID") || code.startsWith("MODE_CONFIG_ROLLBACK_INVALID")) return NextResponse.json({ error: "Конфигурация не прошла валидацию", errorCode: code }, { status: 400 });
    if (code === "MODE_CONFIG_ROLLBACK_NOT_FOUND") return NextResponse.json({ error: "Опубликованная версия для отката не найдена", errorCode: code }, { status: 404 });
    if (code.startsWith("MODE_CONFIG_SERVERS_NOT_REGISTERED")) return NextResponse.json({ error: "Не зарегистрированы все три игровых сервера", errorCode: code }, { status: 409 });
    return errorResponse(error);
  }
}
