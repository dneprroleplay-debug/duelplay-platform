import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isFreshServerManagerRequest } from "../auth";
import { sanitizeUpdateDiagnostic } from "@/lib/cs2-update-store";

export const runtime = "nodejs";

const TERMINAL_STATUSES = new Set(["NO_UPDATE", "INSTANCE_DRIFT", "FAILED", "BLOCKED"]);
const RUN_STAGES = new Set([
  "SCHEDULE_CLAIMED", "BUILD_ID_CHECK", "INSTANCE_DRIFT_CHECK", "PREFLIGHT", "MAINTENANCE_ENABLED",
  "WAITING_FOR_MATCHES", "IDLE_CHECK", "STEAMCMD_UPDATE", "VERIFY_SHARED_BUILD", "SYNCING_INSTANCES",
  "SMOKE_CHECK", "VERIFYING_CLUSTER", "FINALIZING", "COMPLETED", "NO_UPDATE", "INSTANCE_DRIFT", "FAILED",
]);

function boundedBuildId(value: unknown) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  if (!/^\d{1,32}$/.test(text)) throw new Error("INVALID_BUILD_ID");
  return text;
}

function normalizeInstances(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 3) throw new Error("INVALID_INSTANCE_RESULTS");
  return value.map(entry => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("INVALID_INSTANCE_RESULTS");
    const row = entry as Record<string, unknown>;
    const serverName = String(row.serverName ?? "");
    if (!/^cs2-[1-3]$/.test(serverName)) throw new Error("INVALID_INSTANCE_RESULTS");
    return {
      serverName,
      status: sanitizeUpdateDiagnostic(row.status, 48),
      buildId: boundedBuildId(row.buildId),
      serverVersion: boundedBuildId(row.serverVersion),
      differingFiles: typeof row.differingFiles === "number" && Number.isInteger(row.differingFiles) ? Math.max(0, Math.min(100_000, row.differingFiles)) : 0,
      managerReady: typeof row.managerReady === "boolean" ? row.managerReady : null,
      gameProcessReady: typeof row.gameProcessReady === "boolean" ? row.gameProcessReady : null,
      gameProcessStatus: sanitizeUpdateDiagnostic(row.gameProcessStatus, 32),
      gameProcessPid: typeof row.gameProcessPid === "number" && Number.isInteger(row.gameProcessPid) ? row.gameProcessPid : null,
      controlFilesVerified: row.controlFilesVerified === true,
      smokeStatus: sanitizeUpdateDiagnostic(row.smokeStatus, 48),
      checkedAt: sanitizeUpdateDiagnostic(row.checkedAt, 40),
      errorCode: sanitizeUpdateDiagnostic(row.errorCode, 80),
    };
  }) as Prisma.InputJsonValue;
}

function normalizeDiagnostics(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 200) throw new Error("INVALID_DIAGNOSTICS");
  return value.map(entry => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("INVALID_DIAGNOSTICS");
    const row = entry as Record<string, unknown>;
    return {
      code: sanitizeUpdateDiagnostic(row.code, 80),
      serverName: sanitizeUpdateDiagnostic(row.serverName, 32),
      message: sanitizeUpdateDiagnostic(row.message, 500),
      path: sanitizeUpdateDiagnostic(row.path, 300),
      occurredAt: sanitizeUpdateDiagnostic(row.occurredAt, 40),
    };
  }) as Prisma.InputJsonValue;
}

export async function PATCH(request: Request) {
  if (!(await isFreshServerManagerRequest(request))) return NextResponse.json({ errorCode: "UNAUTHORIZED_OR_EXPIRED" }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NextResponse.json({ errorCode: "INVALID_BODY" }, { status: 400 });
    body = parsed as Record<string, unknown>;
  } catch { return NextResponse.json({ errorCode: "INVALID_JSON" }, { status: 400 }); }

  const runId = typeof body.runId === "string" && /^[0-9a-f-]{36}$/i.test(body.runId) ? body.runId : "";
  const stage = String(body.stage ?? "");
  const status = body.status === undefined ? undefined : String(body.status);
  if (!runId || !RUN_STAGES.has(stage) || (status !== undefined && status !== "RUNNING" && !TERMINAL_STATUSES.has(status))) {
    return NextResponse.json({ errorCode: "INVALID_RUN_UPDATE" }, { status: 400 });
  }

  let checkedInstances: Prisma.InputJsonValue | undefined;
  let diagnostics: Prisma.InputJsonValue | undefined;
  let publicBuildId: string | null | undefined;
  let installedBuildIdBefore: string | null | undefined;
  let installedBuildIdAfter: string | null | undefined;
  let serverVersionAfter: string | null | undefined;
  try {
    checkedInstances = normalizeInstances(body.checkedInstances);
    diagnostics = normalizeDiagnostics(body.diagnostics);
    publicBuildId = body.publicBuildId === undefined ? undefined : boundedBuildId(body.publicBuildId);
    installedBuildIdBefore = body.installedBuildIdBefore === undefined ? undefined : boundedBuildId(body.installedBuildIdBefore);
    installedBuildIdAfter = body.installedBuildIdAfter === undefined ? undefined : boundedBuildId(body.installedBuildIdAfter);
    serverVersionAfter = body.serverVersionAfter === undefined ? undefined : boundedBuildId(body.serverVersionAfter);
  } catch (error) {
    return NextResponse.json({ errorCode: error instanceof Error ? error.message : "INVALID_RUN_UPDATE" }, { status: 400 });
  }

  const errorCode = sanitizeUpdateDiagnostic(body.errorCode, 80);
  const errorMessage = sanitizeUpdateDiagnostic(body.errorMessage, 1000);
  const interventionRequired = body.interventionRequired === true;
  const maintenanceEnabled = body.maintenanceEnabled === true;
  const maintenanceWasEnabled = body.maintenanceWasEnabled === true;
  const syncMarkerActive = body.syncMarkerActive === true;
  const now = new Date();

  try {
    const run = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('duelplay:cs2-update-run'), hashtext(${runId}))`;
      const current = await tx.cs2UpdateRun.findUnique({ where: { id: runId } });
      if (!current) throw new Error("UPDATE_RUN_NOT_FOUND");
      if (current.status !== "RUNNING") {
        if (status === current.status) return current;
        throw new Error("UPDATE_RUN_ALREADY_FINISHED");
      }
      const terminal = status !== undefined && TERMINAL_STATUSES.has(status);
      const durationMs = terminal ? Math.max(0, now.getTime() - current.startedAt.getTime()) : undefined;
      const updateData: Prisma.Cs2UpdateRunUpdateInput = {
        stage,
        ...(status ? { status } : {}),
        ...(terminal ? { finishedAt: now, durationMs } : {}),
        ...(publicBuildId !== undefined ? { publicBuildId } : {}),
        ...(installedBuildIdBefore !== undefined ? { installedBuildIdBefore } : {}),
        ...(installedBuildIdAfter !== undefined ? { installedBuildIdAfter } : {}),
        ...(serverVersionAfter !== undefined ? { serverVersionAfter } : {}),
        ...(checkedInstances !== undefined ? { checkedInstances } : {}),
        ...(diagnostics !== undefined ? { diagnostics } : {}),
        ...(body.errorCode !== undefined ? { errorCode } : {}),
        ...(body.errorMessage !== undefined ? { errorMessage } : {}),
        ...(body.interventionRequired !== undefined ? { interventionRequired } : {}),
        ...(body.maintenanceEnabled !== undefined ? { maintenanceEnabled } : {}),
        ...(body.maintenanceWasEnabled !== undefined ? { maintenanceWasEnabled } : {}),
        ...(body.syncMarkerActive !== undefined ? { syncMarkerActive } : {}),
      };
      const updated = await tx.cs2UpdateRun.update({ where: { id: runId }, data: updateData });
      if (status) {
        const summary = {
          status,
          startedAt: current.startedAt.toISOString(),
          finishedAt: terminal ? now.toISOString() : undefined,
          runId,
          localDate: current.localDate,
          stage,
          publicBuildId: publicBuildId ?? current.publicBuildId,
          installedBuildId: installedBuildIdAfter ?? current.installedBuildIdAfter ?? current.installedBuildIdBefore,
          serverVersionAfter: serverVersionAfter ?? current.serverVersionAfter,
          error: errorMessage ?? undefined,
          maintenanceWasEnabled: body.maintenanceWasEnabled === undefined ? undefined : maintenanceWasEnabled,
        };
        await tx.siteSettings.upsert({
          where: { key: "CS2_UPDATE_STATUS" },
          update: { value: summary, updatedBy: null },
          create: { key: "CS2_UPDATE_STATUS", value: summary, description: "Latest automated CS2 update status", updatedBy: null },
        });
      }
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ ok: true, run }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "UPDATE_RUN_NOT_FOUND") return NextResponse.json({ errorCode: code }, { status: 404 });
    if (code === "UPDATE_RUN_ALREADY_FINISHED") return NextResponse.json({ errorCode: code }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return NextResponse.json({ errorCode: "UPDATE_RUN_CONFLICT" }, { status: 409 });
    console.error("[CS2_UPDATE_RUN_REPORT]", error);
    return NextResponse.json({ errorCode: "UPDATE_RUN_REPORT_FAILED" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  if (!(await isFreshServerManagerRequest(request))) return NextResponse.json({ errorCode: "UNAUTHORIZED_OR_EXPIRED" }, { status: 401 });
  const runId = new URL(request.url).searchParams.get("runId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return NextResponse.json({ errorCode: "INVALID_RUN_ID" }, { status: 400 });
  const run = await prisma.cs2UpdateRun.findUnique({ where: { id: runId } });
  if (!run) return NextResponse.json({ errorCode: "UPDATE_RUN_NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ ...run, errorMessage: sanitizeUpdateDiagnostic(run.errorMessage) }, { headers: { "Cache-Control": "no-store" } });
}
