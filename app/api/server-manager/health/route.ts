import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isServerManagerRequest } from "../auth";

const SERVER_NAMES = new Set(["cs2-1", "cs2-2", "cs2-3"]);
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
  const ready = data.ready === true;
  if (!SERVER_NAMES.has(name) || !host || !Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(managerPort) || managerPort < 1 || managerPort > 65535 || typeof data.ready !== "boolean") {
    return NextResponse.json({ error: "INVALID_SERVER_HEALTH" }, { status: 400 });
  }

  const now = new Date();
  try {
    const result = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('duelplay:game-server-claim'))`;
      const existing = await tx.gameServer.findUnique({ where: { name } });
      if (existing?.matchId) {
        await tx.gameServer.update({ where: { id: existing.id }, data: { lastHeartbeat: now } });
        return { ready: false, busy: true, serverId: existing.id };
      }

      const metadata = existing?.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata)
        ? existing.metadata as Record<string, unknown>
        : {};
      const values = {
        host,
        port,
        status: ready ? "READY" as const : "ERROR" as const,
        lastHeartbeat: now,
        metadata: { ...metadata, managerPort, managerReady: ready, heartbeatAt: now.toISOString() },
      };
      const server = existing
        ? await tx.gameServer.update({ where: { id: existing.id }, data: values })
        : await tx.gameServer.create({ data: { name, ...values } });
      return { ready, busy: false, serverId: server.id };
    });
    return NextResponse.json({ ok: true, ...result, heartbeatMaxAgeMs: HEARTBEAT_MAX_AGE_MS });
  } catch (error) {
    console.error("[DuelPlay] server manager health registration failed", error);
    return NextResponse.json({ error: "HEALTH_REGISTRATION_FAILED" }, { status: 500 });
  }
}
