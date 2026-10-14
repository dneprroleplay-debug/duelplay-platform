import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getClientIp } from "@/lib/request-meta";
import { isServerManagerRequest } from "../auth";
import { MAINTENANCE_MESSAGE } from "@/lib/maintenance";

const MANAGED_SERVERS = ["cs2-1", "cs2-2", "cs2-3"];

export async function GET(request: NextRequest) {
  if (!isServerManagerRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [maintenance, activeMatches, servers, updateStatus] = await Promise.all([
    prisma.featureFlag.findUnique({ where: { key: "MAINTENANCE_MODE" }, select: { enabled: true, updatedAt: true } }),
    prisma.match.count({ where: { status: { in: ["STARTING", "LIVE"] } } }),
    prisma.gameServer.findMany({
      where: { name: { in: MANAGED_SERVERS } },
      select: { name: true, host: true, port: true, status: true, matchId: true, lastHeartbeat: true },
      orderBy: { name: "asc" },
    }),
    prisma.siteSettings.findUnique({ where: { key: "CS2_UPDATE_STATUS" }, select: { value: true, updatedAt: true } }),
  ]);
  return NextResponse.json({
    maintenance: maintenance?.enabled ?? false,
    message: MAINTENANCE_MESSAGE,
    activeMatches,
    updateStatus: updateStatus?.value ?? null,
    updateStatusUpdatedAt: updateStatus?.updatedAt ?? null,
    servers: servers.map(server => ({
      ...server,
      heartbeatFresh: Boolean(server.lastHeartbeat && Date.now() - server.lastHeartbeat.getTime() <= 30_000),
    })),
  }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
}

export async function POST(request: NextRequest) {
  if (!isServerManagerRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "INVALID_ENABLED" }, { status: 400 });
  }
  const fields = body as Record<string, unknown>;
  const enabled = typeof fields.enabled === "boolean" ? fields.enabled : undefined;
  const updateStatus = fields.updateStatus;
  if (enabled === undefined && (!updateStatus || typeof updateStatus !== "object" || Array.isArray(updateStatus))) {
    return NextResponse.json({ error: "INVALID_UPDATE" }, { status: 400 });
  }
  if (updateStatus) {
    const status = (updateStatus as Record<string, unknown>).status;
    const startedAt = (updateStatus as Record<string, unknown>).startedAt;
    const finishedAt = (updateStatus as Record<string, unknown>).finishedAt;
    const error = (updateStatus as Record<string, unknown>).error;
    if (!["RUNNING", "SUCCEEDED", "FAILED"].includes(String(status)) || typeof startedAt !== "string" || (finishedAt !== undefined && typeof finishedAt !== "string") || (error !== undefined && (typeof error !== "string" || error.length > 1000))) {
      return NextResponse.json({ error: "INVALID_UPDATE_STATUS" }, { status: 400 });
    }
  }
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent") || "duelplay-cs2-update";
  const row = await prisma.$transaction(async tx => {
    let flag: { id: string; enabled: boolean } | null = null;
    if (enabled !== undefined) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('duelplay:maintenance-match-ops'))`;
      flag = await tx.featureFlag.upsert({
        where: { key: "MAINTENANCE_MODE" },
        update: { enabled },
        create: { key: "MAINTENANCE_MODE", enabled, updatedBy: null },
      });
      await tx.auditLog.create({
        data: {
          action: enabled ? "ENABLE_CS2_AUTO_UPDATE_MAINTENANCE" : "DISABLE_CS2_AUTO_UPDATE_MAINTENANCE",
          targetType: "PLATFORM",
          targetId: flag.id,
          ipAddress: ip,
          userAgent,
          result: "SUCCESS",
          reason: "Automated CS2 maintenance window",
          payload: { enabled, source: "CS2_UPDATE_AUTOMATION" },
        },
      });
    }
    if (updateStatus) {
      await tx.siteSettings.upsert({
        where: { key: "CS2_UPDATE_STATUS" },
        update: { value: updateStatus as object, updatedBy: null },
        create: { key: "CS2_UPDATE_STATUS", value: updateStatus as object, description: "Latest automated CS2 update status", updatedBy: null },
      });
    }
    return flag;
  });
  return NextResponse.json({ ok: true, enabled: row?.enabled, message: MAINTENANCE_MESSAGE }, { headers: { "Cache-Control": "no-store" } });
}
