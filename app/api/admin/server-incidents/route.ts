import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAnyPermission, requirePermission } from "@/lib/admin-rbac";
import { auditRequest } from "@/lib/admin";
import { cleanTechnicalText } from "@/lib/server-technical-events";

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "ADMIN_LOGIN_REQUIRED") return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401 });
  if (code === "ADMIN_MFA_SETUP_REQUIRED" || code === "ADMIN_MFA_REQUIRED") return NextResponse.json({ error: code }, { status: 403 });
  return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
}

export async function GET(request: NextRequest) {
  try {
    await requireAnyPermission(["system.incidents.view", "system.incidents.manage"]);
    const params = request.nextUrl.searchParams;
    const page = Math.max(1, Number(params.get("page") || 1));
    const pageSize = Math.min(100, Math.max(1, Number(params.get("pageSize") || 50)));
    if (!Number.isInteger(page) || page > 500 || !Number.isInteger(pageSize)) return NextResponse.json({ error: "INVALID_PAGINATION" }, { status: 400 });
    const status = params.get("status")?.slice(0, 24);
    const serverName = params.get("server")?.slice(0, 64);
    const severity = params.get("severity")?.toUpperCase().slice(0, 16);
    const incidentId = params.get("id");
    const rows = await prisma.serverIncident.findMany({
      where: { ...(incidentId ? { id: incidentId } : {}), ...(status ? { status } : {}), ...(serverName ? { serverName } : {}), ...(severity ? { severity } : {}) },
      orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize + 1,
      select: { id: true, serverName: true, category: true, severity: true, title: true, message: true, status: true, occurrences: true, firstSeenAt: true, lastSeenAt: true, acknowledgedAt: true, resolvedAt: true, _count: { select: { events: true } } },
    });
    return NextResponse.json({ items: rows.slice(0, pageSize), page, pageSize, hasMore: rows.length > pageSize }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    const actor = await requirePermission("system.incidents.manage");
    const body = await request.json().catch(() => ({}));
    const id = typeof body.id === "string" ? body.id : "";
    const action = body.action;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) || !["acknowledge", "resolve"].includes(action)) return NextResponse.json({ error: "INVALID_INCIDENT_ACTION" }, { status: 400 });
    const current = await prisma.serverIncident.findUnique({ where: { id }, select: { id: true, status: true, serverName: true } });
    if (!current) return NextResponse.json({ error: "INCIDENT_NOT_FOUND" }, { status: 404 });
    if (current.status === "RESOLVED") return NextResponse.json({ error: "INCIDENT_ALREADY_RESOLVED" }, { status: 409 });
    const reason = typeof body.reason === "string" ? cleanTechnicalText(body.reason, 1000) : "";
    if (action === "resolve" && !reason) return NextResponse.json({ error: "RESOLUTION_REASON_REQUIRED" }, { status: 400 });
    const now = new Date();
    const incident = await prisma.serverIncident.update({ where: { id }, data: action === "acknowledge"
      ? { status: "ACKNOWLEDGED", acknowledgedAt: now, acknowledgedById: actor.user.id }
      : { status: "RESOLVED", resolution: { reason }, resolvedAt: now } });
    await auditRequest(request, actor.user.id, action === "acknowledge" ? "SERVER_INCIDENT_ACKNOWLEDGE" : "SERVER_INCIDENT_RESOLVE", "SERVER_INCIDENT", id, { serverName: current.serverName, reason: action === "resolve" ? reason : null });
    return NextResponse.json({ ok: true, incident });
  } catch (error) { return errorResponse(error); }
}
