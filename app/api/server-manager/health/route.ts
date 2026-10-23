import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isServerManagerRequest } from "../auth";

const HEARTBEAT_MAX_AGE_MS = 30_000;

export async function POST(request: NextRequest) {
  if (!isServerManagerRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });

  const data = body as Record<string, unknown>;
  const name = String(data.serverName ?? "");
  const host = String(data.host ?? "");
  const port = Number(data.port);
  const managerPort = Number(data.managerPort);
  const ready = typeof data.managerReady === "boolean" ? data.managerReady : data.ready === true;
  const gameProcessReady = data.gameProcessReady === true;
  const gameProcessStatus = typeof data.gameProcessStatus === "string" && ["STOPPED", "STARTING", "READY", "ERROR", "STOPPING"].includes(data.gameProcessStatus) ? data.gameProcessStatus : gameProcessReady ? "READY" : "STOPPED";
  const processId = Number.isInteger(data.gameProcessPid) && Number(data.gameProcessPid) > 0 ? Number(data.gameProcessPid) : null;
  const hasModeConfigVersion = Object.hasOwn(data, "modeConfigVersion");
  const modeConfigVersion = data.modeConfigVersion === null || data.modeConfigVersion === undefined ? null : Number(data.modeConfigVersion);
  const modeConfigChecksum = data.modeConfigChecksum === null || data.modeConfigChecksum === undefined ? null : String(data.modeConfigChecksum);
  const modeControllerVersion = data.modeControllerVersion === null || data.modeControllerVersion === undefined ? null : String(data.modeControllerVersion);
  const modeControllerCapabilities = data.modeControllerCapabilities === undefined ? null : data.modeControllerCapabilities;
  if (!/^cs2-[1-9]\d*$/.test(name) || !host || !Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(managerPort) || managerPort < 1 || managerPort > 65535 || typeof data.ready !== "boolean" || (data.managerReady !== undefined && typeof data.managerReady !== "boolean") || (data.gameProcessReady !== undefined && typeof data.gameProcessReady !== "boolean") || (hasModeConfigVersion && modeConfigVersion !== null && (!Number.isInteger(modeConfigVersion) || modeConfigVersion < 0)) || (modeConfigChecksum !== null && !/^[a-f0-9]{64}$/i.test(modeConfigChecksum)) || (modeControllerVersion !== null && modeControllerVersion.length > 64) || (modeControllerCapabilities !== null && (!Array.isArray(modeControllerCapabilities) || modeControllerCapabilities.some(value => typeof value !== "string" || value.length > 64)))) {
    return NextResponse.json({ error: "INVALID_SERVER_HEALTH" }, { status: 400 });
  }

  const now = new Date();
  try {
    const result = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('duelplay:game-server-claim'))`;
      const existing = await tx.gameServer.findUnique({ where: { name } });
      if (!existing) throw new Error("SERVER_NOT_REGISTERED");
      const existingMetadata = existing.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata) ? existing.metadata as Record<string, unknown> : {};
      if (existing.port !== port || (existingMetadata.managerPort !== undefined && Number(existingMetadata.managerPort) !== managerPort)) throw new Error("SERVER_REGISTRY_MISMATCH");
      if (existing?.matchId) {
        await tx.gameServer.update({ where: { id: existing.id }, data: { lastHeartbeat: now } });
        return { ready: false, busy: true, serverId: existing.id };
      }

      const metadata = existing?.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata)
        ? existing.metadata as Record<string, unknown>
        : {};
      const modeConfigMetadata = hasModeConfigVersion ? {
        modeConfigVersion,
        modeConfigChecksum,
        modeControllerVersion,
        modeControllerCapabilities,
      } : {};
      const values = {
        host,
        port,
        status: ready ? "READY" as const : "ERROR" as const,
        processId: gameProcessReady ? processId : null,
        lastHeartbeat: now,
        metadata: { ...metadata, managerPort, managerReady: ready, gameProcessReady, gameProcessStatus, gameProcessPid: gameProcessReady ? processId : null, heartbeatAt: now.toISOString(), ...modeConfigMetadata },
      };
      const server = await tx.gameServer.update({ where: { id: existing.id }, data: values });
      return { ready, busy: false, serverId: server.id };
    });
    return NextResponse.json({ ok: true, ...result, heartbeatMaxAgeMs: HEARTBEAT_MAX_AGE_MS });
  } catch (error) {
    if (error instanceof Error && error.message === "SERVER_NOT_REGISTERED") return NextResponse.json({ error: "SERVER_NOT_REGISTERED" }, { status: 409 });
    if (error instanceof Error && error.message === "SERVER_REGISTRY_MISMATCH") return NextResponse.json({ error: "SERVER_REGISTRY_MISMATCH" }, { status: 409 });
    console.error("[DuelPlay] server manager health registration failed", error);
    return NextResponse.json({ error: "HEALTH_REGISTRATION_FAILED" }, { status: 500 });
  }
}
