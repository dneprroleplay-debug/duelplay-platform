import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCs2AutoUpdateAdmin } from "@/lib/admin-rbac";
import { getAuditContext } from "@/lib/request-meta";
import { buildCs2ScheduleAuditPayload, CS2_UPDATE_TIME_ZONE, DEFAULT_CS2_UPDATE_TIME, getNextCs2UpdateAt, isValidCs2UpdateTime, normalizeCs2UpdateSchedule } from "@/lib/cs2-update-schedule.mjs";
import { CS2_UPDATE_SCHEDULE_KEY, CS2_UPDATE_SCHEDULE_LOCK, readCs2UpdateSchedule, sanitizeUpdateDiagnostic } from "@/lib/cs2-update-store";

export const runtime = "nodejs";

function adminError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "ADMIN_LOGIN_REQUIRED") return NextResponse.json({ error: "Требуется вход администратора", errorCode: code }, { status: 401 });
  if (code.startsWith("ADMIN_MFA_")) return NextResponse.json({ error: "Требуется подтверждение MFA администратора", errorCode: code }, { status: 403 });
  if (code === "FORBIDDEN") return NextResponse.json({ error: "Управление автообновлением CS2 доступно только SUPERADMIN и администратору уровня 999", errorCode: code }, { status: 403 });
  console.error("[CS2_AUTO_UPDATE_ADMIN]", error);
  return NextResponse.json({ error: "Не удалось получить настройки автообновления CS2", errorCode: code || "CS2_AUTO_UPDATE_ADMIN_ERROR" }, { status: 500 });
}

function safeRun(run: {
  id: string;
  localDate: string;
  scheduledAt: Date;
  scheduledLocalTime: string;
  timeZone: string;
  scheduleRevision: number;
  source: string;
  status: string;
  stage: string;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  publicBuildId: string | null;
  installedBuildIdBefore: string | null;
  installedBuildIdAfter: string | null;
  checkedInstances: Prisma.JsonValue | null;
  diagnostics: Prisma.JsonValue | null;
  errorCode: string | null;
  errorMessage: string | null;
  interventionRequired: boolean;
  maintenanceEnabled: boolean;
  syncMarkerActive: boolean;
}) {
  return { ...run, errorMessage: sanitizeUpdateDiagnostic(run.errorMessage) };
}

export async function GET() {
  try {
    const access = await requireCs2AutoUpdateAdmin();
    const [scheduleRead, runs, servers, maintenance] = await Promise.all([
      readCs2UpdateSchedule(),
      prisma.cs2UpdateRun.findMany({ orderBy: { startedAt: "desc" }, take: 30 }),
      prisma.gameServer.findMany({
        where: { name: { in: ["cs2-1", "cs2-2", "cs2-3"] } },
        select: { name: true, status: true, lastHeartbeat: true, matchId: true, processId: true, metadata: true },
        orderBy: { name: "asc" },
      }),
      prisma.featureFlag.findUnique({ where: { key: "MAINTENANCE_MODE" }, select: { enabled: true, updatedAt: true } }),
    ]);
    const schedule = scheduleRead.schedule;
    const now = new Date();
    const checkedAt = schedule?.lastCheckedAt ? new Date(schedule.lastCheckedAt) : null;
    const agentFresh = Boolean(checkedAt && Number.isFinite(checkedAt.getTime()) && now.getTime() - checkedAt.getTime() <= 150_000);
    const latestActualUpdate = runs.find(run => ["UPDATED", "UPDATED_WITH_DIAGNOSTICS"].includes(run.status)) ?? null;

    return NextResponse.json({
      me: { roleCode: access.roleCode, level: access.level },
      schedule: schedule ? {
        enabled: schedule.enabled,
        localTime: schedule.localTime,
        timeZone: CS2_UPDATE_TIME_ZONE,
        revision: schedule.revision,
        scheduleChangedAt: schedule.scheduleChangedAt,
        configured: scheduleRead.configured,
        invalid: scheduleRead.invalid,
        nextRunAt: getNextCs2UpdateAt(schedule, now),
        lastCheckedAt: schedule.lastCheckedAt,
        agentStatus: schedule.agentStatus,
        agentError: sanitizeUpdateDiagnostic(schedule.agentError),
        agentFresh,
      } : {
        enabled: false,
        localTime: DEFAULT_CS2_UPDATE_TIME,
        timeZone: CS2_UPDATE_TIME_ZONE,
        revision: 0,
        scheduleChangedAt: null,
        configured: scheduleRead.configured,
        invalid: true,
        nextRunAt: null,
        lastCheckedAt: null,
        agentStatus: "CONFIG_INVALID",
        agentError: "Schedule configuration is invalid; automation is fail-closed.",
        agentFresh: false,
      },
      maintenance: { enabled: maintenance?.enabled ?? false, updatedAt: maintenance?.updatedAt ?? null },
      lastCheckAt: schedule?.lastCheckedAt ?? null,
      lastActualUpdateAt: latestActualUpdate?.finishedAt ?? null,
      servers: servers.map(server => {
        const metadata = server.metadata && typeof server.metadata === "object" && !Array.isArray(server.metadata) ? server.metadata as Record<string, unknown> : {};
        return {
          name: server.name,
          status: server.status,
          lastHeartbeat: server.lastHeartbeat,
          heartbeatFresh: Boolean(server.lastHeartbeat && now.getTime() - server.lastHeartbeat.getTime() <= 30_000),
          hasMatch: Boolean(server.matchId),
          processId: server.processId,
          managerReady: metadata.managerReady === true,
          gameProcessReady: metadata.gameProcessReady === true,
          gameProcessStatus: typeof metadata.gameProcessStatus === "string" ? metadata.gameProcessStatus : "UNKNOWN",
          modeControllerVersion: typeof metadata.modeControllerVersion === "string" ? metadata.modeControllerVersion : null,
          modeControllerCapabilities: Array.isArray(metadata.modeControllerCapabilities) ? metadata.modeControllerCapabilities.filter(value => typeof value === "string").slice(0, 30) : [],
        };
      }),
      runs: runs.map(safeRun),
    }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
  } catch (error) { return adminError(error); }
}

export async function PUT(request: NextRequest) {
  let access: Awaited<ReturnType<typeof requireCs2AutoUpdateAdmin>>;
  try { access = await requireCs2AutoUpdateAdmin(); }
  catch (error) { return adminError(error); }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NextResponse.json({ error: "Некорректный запрос", errorCode: "INVALID_BODY" }, { status: 400 });
    body = parsed as Record<string, unknown>;
  } catch { return NextResponse.json({ error: "Некорректный JSON", errorCode: "INVALID_JSON" }, { status: 400 }); }

  if (typeof body.enabled !== "boolean" || !isValidCs2UpdateTime(body.localTime) || (body.timeZone !== undefined && body.timeZone !== CS2_UPDATE_TIME_ZONE)) {
    return NextResponse.json({ error: "Укажите состояние, время в формате HH:mm и фиксированный часовой пояс Europe/Kyiv", errorCode: "INVALID_SCHEDULE" }, { status: 400 });
  }
  const expectedRevision = Number(body.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) return NextResponse.json({ error: "Обновите данные расписания и повторите сохранение", errorCode: "INVALID_SCHEDULE_REVISION" }, { status: 400 });

  try {
    const context = getAuditContext(request);
    const result = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${CS2_UPDATE_SCHEDULE_LOCK}))`;
      const currentRead = await readCs2UpdateSchedule(tx);
      const current = currentRead.schedule;
      const currentRevision = current?.revision ?? 0;
      if (currentRevision !== expectedRevision) throw new Error("CS2_UPDATE_SCHEDULE_CONFLICT");
      const scheduleChangedAt = new Date().toISOString();
      const next = normalizeCs2UpdateSchedule({
        enabled: body.enabled,
        localTime: body.localTime,
        timeZone: CS2_UPDATE_TIME_ZONE,
        revision: currentRevision + 1,
        scheduleChangedAt,
        lastCheckedAt: current?.lastCheckedAt ?? null,
        agentStatus: current?.agentStatus ?? "UNKNOWN",
        agentError: current?.agentError ?? null,
      });
      if (!next) throw new Error("CS2_UPDATE_SCHEDULE_INVALID");
      const auditPayload = buildCs2ScheduleAuditPayload(current, next);
      const row = await tx.siteSettings.upsert({
        where: { key: CS2_UPDATE_SCHEDULE_KEY },
        update: { value: next as Prisma.InputJsonValue, description: "Central CS2 auto-update schedule", updatedBy: access.user.id },
        create: { key: CS2_UPDATE_SCHEDULE_KEY, value: next as Prisma.InputJsonValue, description: "Central CS2 auto-update schedule", updatedBy: access.user.id },
        select: { value: true },
      });
      await tx.auditLog.create({
        data: {
          userId: access.user.id,
          action: "CS2_AUTO_UPDATE_SCHEDULE_CHANGED",
          targetType: "CS2_UPDATE_SCHEDULE",
          targetId: "global",
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          requestId: context.requestId,
          result: "SUCCESS",
          payload: auditPayload as Prisma.InputJsonValue,
        },
      });
      return { schedule: normalizeCs2UpdateSchedule(row.value), changed: true };
    });
    if (!result.schedule) throw new Error("CS2_UPDATE_SCHEDULE_INVALID");
    return NextResponse.json({ ok: true, changed: result.changed, schedule: result.schedule, nextRunAt: getNextCs2UpdateAt(result.schedule) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "CS2_UPDATE_SCHEDULE_CONFLICT") return NextResponse.json({ error: "Расписание уже изменено другим администратором. Обновите страницу.", errorCode: code }, { status: 409 });
    if (code === "CS2_UPDATE_SCHEDULE_INVALID") return NextResponse.json({ error: "Хранимая конфигурация расписания некорректна; автоматизация остаётся выключенной.", errorCode: code }, { status: 409 });
    console.error("[CS2_AUTO_UPDATE_SCHEDULE_SAVE]", error);
    return NextResponse.json({ error: "Не удалось сохранить расписание CS2", errorCode: code || "CS2_UPDATE_SCHEDULE_SAVE_FAILED" }, { status: 500 });
  }
}
