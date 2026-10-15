import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/admin-rbac";

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "ADMIN_LOGIN_REQUIRED") return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401 });
  if (code === "ADMIN_MFA_SETUP_REQUIRED" || code === "ADMIN_MFA_REQUIRED") return NextResponse.json({ error: code }, { status: 403 });
  return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
}

export async function GET(request: NextRequest) {
  try {
    await requirePermission("system.logs.view");
    const params = request.nextUrl.searchParams;
    const page = Math.max(1, Number(params.get("page") || 1));
    const pageSize = Math.min(100, Math.max(1, Number(params.get("pageSize") || 50)));
    if (!Number.isInteger(page) || page > 500 || !Number.isInteger(pageSize)) return NextResponse.json({ error: "INVALID_PAGINATION" }, { status: 400 });
    const serverName = params.get("server")?.slice(0, 64);
    const severity = params.get("severity")?.toUpperCase().slice(0, 16);
    const category = params.get("component")?.slice(0, 64);
    const query = params.get("q")?.trim().slice(0, 120);
    const from = params.get("from") ? new Date(params.get("from")!) : null;
    const to = params.get("to") ? new Date(params.get("to")!) : null;
    if ((from && !Number.isFinite(from.getTime())) || (to && !Number.isFinite(to.getTime()))) return NextResponse.json({ error: "INVALID_DATE_FILTER" }, { status: 400 });
    const where = {
      ...(serverName ? { serverName } : {}),
      ...(severity ? { severity } : {}),
      ...(category ? { category: { contains: category, mode: "insensitive" as const } } : {}),
      ...((from || to) ? { occurredAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      ...(query ? { OR: [{ message: { contains: query, mode: "insensitive" as const } }, { source: { contains: query, mode: "insensitive" as const } }, { category: { contains: query, mode: "insensitive" as const } }] } : {}),
    };
    const rows = await prisma.serverTechnicalEvent.findMany({
      where,
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize + 1,
      select: { id: true, eventId: true, serverName: true, source: true, category: true, severity: true, message: true, details: true, correlationId: true, matchId: true, result: true, occurredAt: true, receivedAt: true, incidentId: true },
    });
    return NextResponse.json({ items: rows.slice(0, pageSize), page, pageSize, hasMore: rows.length > pageSize }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
