import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditRequest } from "@/lib/admin";
import { requirePermission } from "@/lib/admin-rbac";

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "ADMIN_LOGIN_REQUIRED") return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401 });
  if (code === "ADMIN_MFA_SETUP_REQUIRED" || code === "ADMIN_MFA_REQUIRED") return NextResponse.json({ error: code }, { status: 403 });
  return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
}

function safeMetadata(value: unknown) {
  const data = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    managerPort: data.managerPort ?? null,
    instanceRoot: data.instanceRoot ?? null,
    serviceName: data.serviceName ?? null,
    registryStatus: data.registryStatus ?? "REGISTERED",
    managerReady: data.managerReady === true,
    gameProcessReady: data.gameProcessReady === true,
    gameProcessStatus: data.gameProcessStatus ?? "UNKNOWN",
    componentStatus: data.componentStatus ?? "UNKNOWN",
    bundleVersion: data.bundleVersion ?? null,
  };
}

export async function GET() {
  try {
    await requirePermission("servers.view");
    const rows = await prisma.gameServer.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, host: true, port: true, status: true, matchId: true, processId: true, lastHeartbeat: true, createdAt: true, metadata: true } });
    return NextResponse.json({ servers: rows.map(({ metadata, ...row }) => ({ ...row, metadata: safeMetadata(metadata) })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requirePermission("servers.manage");
    const body = await request.json().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const host = typeof body.host === "string" ? body.host.trim() : "";
    const port = Number(body.port);
    const managerPort = Number(body.managerPort);
    if (!/^cs2-[1-9]\d*$/.test(name) || !host || host.length > 253 || !/^[A-Za-z0-9.:-]+$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(managerPort) || managerPort < 1 || managerPort > 65535 || port === managerPort) {
      return NextResponse.json({ error: "INVALID_SERVER_REGISTRATION" }, { status: 400 });
    }
    const instanceRoot = `/home/ubuntu/cs2/instances/${name}/root`;
    const serviceName = `duelplay-cs2-manager@${name}.service`;
    const server = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('duelplay:server-registry'))`;
      const rows = await tx.gameServer.findMany({ select: { name: true, port: true, metadata: true } });
      if (rows.some(row => row.name === name)) throw new Error("SERVER_ID_EXISTS");
      const occupiedPorts = new Set<number>();
      for (const row of rows) {
        occupiedPorts.add(row.port);
        const meta = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata as Record<string, unknown> : {};
        const currentManagerPort = Number(meta.managerPort);
        if (Number.isInteger(currentManagerPort)) occupiedPorts.add(currentManagerPort);
      }
      if (occupiedPorts.has(port) || occupiedPorts.has(managerPort)) throw new Error("SERVER_PORT_CONFLICT");
      return tx.gameServer.create({ data: { name, host, port, status: "OFFLINE", metadata: { managerPort, instanceRoot, serviceName, registryStatus: "REGISTERED", managerReady: false, gameProcessReady: false, gameProcessStatus: "STOPPED", componentStatus: "UNKNOWN", bundleVersion: null } } });
    });
    await auditRequest(request, actor.user.id, "SERVER_REGISTER", "GAME_SERVER", server.id, { name, host, port, managerPort, instanceRoot, serviceName });
    return NextResponse.json({ ok: true, server: { id: server.id, name, host, port, managerPort, instanceRoot, serviceName, status: server.status, provisioning: "NOT_STARTED" } }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "SERVER_ID_EXISTS") return NextResponse.json({ error: code }, { status: 409 });
    if (code === "SERVER_PORT_CONFLICT") return NextResponse.json({ error: code }, { status: 409 });
    return errorResponse(error);
  }
}
