import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentAdminSession } from "@/lib/admin-auth";
import { hasPermission, resolveAdminAccess } from "@/lib/admin-rbac";
import { auditRequest } from "@/lib/admin";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getCurrentAdminSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await resolveAdminAccess(session.user.id);
  if (!access || !hasPermission(access.permissions, "servers.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const raw = body.allowNewMatches;
  const explicit = raw === true || raw === false || raw === "true" || raw === "false" || raw === 1 || raw === 0;
  if (!explicit) return NextResponse.json({ error: "Invalid value" }, { status: 400 });
  const value = raw === true || raw === "true" || raw === 1 || raw === "1";

  const updated = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('duelplay:game-server-claim'))`;
    const server = await tx.gameServer.update({
      where: { id },
      data: { allowNewMatches: value },
    });
    return server;
  });

  await auditRequest(request, session.user.id, "GAME_SERVER_ALLOW_NEW_MATCHES_CHANGED", "GameServer", id, { name: updated.name, allowNewMatches: value });

  return NextResponse.json({ ok: true, server: updated });
}
