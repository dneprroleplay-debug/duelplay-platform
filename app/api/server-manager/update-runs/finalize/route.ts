import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuditContext } from "@/lib/request-meta";
import { isFreshServerManagerRequest } from "../../auth";

export const runtime = "nodejs";

const REQUIRED_SERVERS = ["cs2-1", "cs2-2", "cs2-3"] as const;

function allInstancesVerified(value: Prisma.JsonValue | null, expectedBuildId: string, expectedServerVersion: string) {
  if (!Array.isArray(value)) return false;
  const byName = new Map(value.filter(item => item && typeof item === "object" && !Array.isArray(item)).map(item => {
    const row = item as Record<string, Prisma.JsonValue>;
    return [String(row.serverName ?? ""), row] as const;
  }));
  if (byName.size !== REQUIRED_SERVERS.length) return false;
  return REQUIRED_SERVERS.every(serverName => {
    const row = byName.get(serverName);
    return row?.status === "READY" && row.controlFilesVerified === true && row.buildId === expectedBuildId
      && row.serverVersion === expectedServerVersion
      && ["READY", "READY_WITH_SHUTDOWN_DIAGNOSTIC"].includes(String(row.smokeStatus ?? ""))
      && row.managerReady === true && row.gameProcessReady === false && row.gameProcessStatus === "STOPPED" && row.gameProcessPid == null;
  });
}

export async function POST(request: Request) {
  if (!(await isFreshServerManagerRequest(request))) return NextResponse.json({ errorCode: "UNAUTHORIZED_OR_EXPIRED" }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NextResponse.json({ errorCode: "INVALID_BODY" }, { status: 400 });
    body = parsed as Record<string, unknown>;
  } catch { return NextResponse.json({ errorCode: "INVALID_JSON" }, { status: 400 }); }

  const runId = typeof body.runId === "string" && /^[0-9a-f-]{36}$/i.test(body.runId) ? body.runId : "";
  const status = String(body.status ?? "");
  if (!runId || !["UPDATED", "UPDATED_WITH_DIAGNOSTICS"].includes(status)) return NextResponse.json({ errorCode: "INVALID_FINALIZATION" }, { status: 400 });
  const auditContext = getAuditContext(request);
  const now = new Date();

  try {
    const result = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('duelplay:maintenance-match-ops'))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('duelplay:cs2-update-run'), hashtext(${runId}))`;
      const run = await tx.cs2UpdateRun.findUnique({ where: { id: runId } });
      if (!run) throw new Error("UPDATE_RUN_NOT_FOUND");
      if (run.status !== "RUNNING") throw new Error("UPDATE_RUN_NOT_RUNNING");
      if (!run.publicBuildId || run.installedBuildIdAfter !== run.publicBuildId || !run.serverVersionAfter) throw new Error("UPDATE_BUILD_ID_NOT_CONFIRMED");
      if (!allInstancesVerified(run.checkedInstances, run.installedBuildIdAfter, run.serverVersionAfter)) throw new Error("UPDATE_INSTANCE_VERIFICATION_INCOMPLETE");
      const diagnosticRows = Array.isArray(run.diagnostics) ? run.diagnostics.filter(value => value && typeof value === "object" && !Array.isArray(value)) : [];
      if ((status === "UPDATED_WITH_DIAGNOSTICS") !== (diagnosticRows.length > 0)) throw new Error("UPDATE_DIAGNOSTIC_STATUS_MISMATCH");
      const [activeMatches, servers, maintenance] = await Promise.all([
        tx.match.count({ where: { status: { in: ["STARTING", "LIVE"] } } }),
        tx.gameServer.findMany({ where: { name: { in: [...REQUIRED_SERVERS] } }, select: { name: true, status: true, matchId: true, processId: true, lastHeartbeat: true, metadata: true } }),
        tx.featureFlag.findUnique({ where: { key: "MAINTENANCE_MODE" }, select: { id: true, enabled: true } }),
      ]);
      if (activeMatches !== 0) throw new Error("UPDATE_MATCHES_STILL_ACTIVE");
      const serverByName = new Map(servers.map(server => [server.name, server]));
      const healthyGroup = REQUIRED_SERVERS.every(name => {
        const server = serverByName.get(name);
        const metadata = server?.metadata && typeof server.metadata === "object" && !Array.isArray(server.metadata) ? server.metadata as Record<string, unknown> : {};
        return Boolean(server && server.status === "READY" && !server.matchId && !server.processId
          && server.lastHeartbeat && now.getTime() - server.lastHeartbeat.getTime() <= 30_000
          && metadata.managerReady === true && metadata.gameProcessStatus === "STOPPED" && metadata.gameProcessPid == null);
      });
      if (!healthyGroup) throw new Error("UPDATE_SERVER_GROUP_NOT_READY");
      if (!run.maintenanceWasEnabled && !maintenance?.enabled) throw new Error("UPDATE_MAINTENANCE_GATE_MISSING");

      const keepMaintenance = run.maintenanceWasEnabled;
      if (!keepMaintenance && maintenance?.enabled) {
        await tx.featureFlag.update({ where: { key: "MAINTENANCE_MODE" }, data: { enabled: false } });
        await tx.auditLog.create({
          data: {
            userId: null,
            action: "DISABLE_CS2_AUTO_UPDATE_MAINTENANCE",
            targetType: "PLATFORM",
            targetId: maintenance.id,
            ipAddress: auditContext.ipAddress,
            userAgent: "duelplay-cs2-update-automation",
            requestId: auditContext.requestId,
            result: "SUCCESS",
            reason: "All three CS2 instances passed update readiness checks.",
            payload: { source: "CS2_UPDATE_AUTOMATION", runId, buildId: run.installedBuildIdAfter },
          },
        });
      }
      const summary = {
        status,
        startedAt: run.startedAt.toISOString(),
        finishedAt: now.toISOString(),
        runId,
        localDate: run.localDate,
        publicBuildId: run.publicBuildId,
        installedBuildId: run.installedBuildIdAfter,
        serverVersion: run.serverVersionAfter,
        diagnostics: run.diagnostics,
      };
      await tx.siteSettings.upsert({
        where: { key: "CS2_UPDATE_STATUS" },
        update: { value: summary, updatedBy: null },
        create: { key: "CS2_UPDATE_STATUS", value: summary, description: "Latest automated CS2 update status", updatedBy: null },
      });
      const updated = await tx.cs2UpdateRun.update({
        where: { id: runId },
        data: {
          status,
          stage: "COMPLETED",
          finishedAt: now,
          durationMs: Math.max(0, now.getTime() - run.startedAt.getTime()),
          maintenanceEnabled: keepMaintenance,
          syncMarkerActive: false,
          interventionRequired: false,
        },
      });
      return { run: updated, maintenanceEnabled: keepMaintenance };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "UPDATE_RUN_NOT_FOUND") return NextResponse.json({ errorCode: code }, { status: 404 });
    if (code === "UPDATE_RUN_NOT_RUNNING" || code.startsWith("UPDATE_")) return NextResponse.json({ errorCode: code }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return NextResponse.json({ errorCode: "UPDATE_FINALIZATION_CONFLICT" }, { status: 409 });
    console.error("[CS2_UPDATE_FINALIZE]", error);
    return NextResponse.json({ errorCode: "UPDATE_FINALIZATION_FAILED" }, { status: 500 });
  }
}
