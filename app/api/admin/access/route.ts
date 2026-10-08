import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ADMIN_ROLE_DEFINITIONS, ADMIN_ROLE_CODES, resolveAdminAccess, requirePermission, hasPermission, isProtectedFounder } from "@/lib/admin-rbac";
import { requireAdmin } from "@/lib/admin";
import { auditRequest } from "@/lib/admin";
import { getCurrentAdminSession } from "@/lib/admin-auth";

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "ADMIN_LOGIN_REQUIRED") return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401 });
  if (code === "ADMIN_MFA_SETUP_REQUIRED" || code === "ADMIN_MFA_REQUIRED") return NextResponse.json({ error: "Требуется подтверждение MFA" }, { status: 403 });
  return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
}

export async function GET() {
  try {
    await requireAdmin(1);
    const session = await getCurrentAdminSession();
    const sessionAccess = session?.user ? await resolveAdminAccess(session.user.id) : null;
    if (!sessionAccess) throw new Error("FORBIDDEN");
    const access = sessionAccess;
    const [assignments, users] = await Promise.all([
      prisma.adminRoleAssignment.findMany({
        include: { user: { select: { id: true, nickname: true, steamId: true, role: true, status: true } } },
        orderBy: [{ level: "asc" }, { createdAt: "asc" }],
      }),
      prisma.user.findMany({
        where: { deletedAt: null },
        orderBy: { nickname: "asc" },
        take: 500,
        select: { id: true, nickname: true, steamId: true, role: true, status: true },
      }),
    ]);
    const roles = ADMIN_ROLE_CODES.map(code => {
      const def = ADMIN_ROLE_DEFINITIONS[code];
      return { code, level: def.level, title: def.title, description: def.description, permissions: [...def.permissions] };
    });
    return NextResponse.json({
      me: { id: access.user.id, nickname: access.user.nickname, roleCode: access.roleCode, level: access.level, permissions: access.permissions },
      founder: access.roleCode === "FOUNDER",
      roles,
      assignments: access.roleCode === "FOUNDER" || hasPermission(access.permissions, "roles.manage") ? assignments : [],
      users: access.roleCode === "FOUNDER" || hasPermission(access.permissions, "roles.manage") ? users : [],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requirePermission("roles.manage");
    const body = await request.json().catch(() => ({}));
    const userId = String(body.userId || "");
    const roleCode = String(body.roleCode || "") as typeof ADMIN_ROLE_CODES[number];
    if (!userId || !ADMIN_ROLE_CODES.includes(roleCode)) return NextResponse.json({ error: "Некорректный пользователь или роль" }, { status: 400 });
    if (roleCode === "FOUNDER" && actor.roleCode !== "FOUNDER") return NextResponse.json({ error: "Назначать Founder может только Founder" }, { status: 403 });
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, nickname: true, steamId: true, role: true, status: true } });
    if (!target) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
    if (isProtectedFounder(target) && target.id !== actor.user.id) return NextResponse.json({ error: "Founder защищён" }, { status: 403 });
    if (roleCode === "FOUNDER" && target.id !== actor.user.id && actor.roleCode !== "FOUNDER") return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });

    const def = ADMIN_ROLE_DEFINITIONS[roleCode];
    const override = body.permissionOverrides && typeof body.permissionOverrides === "object" && !Array.isArray(body.permissionOverrides) ? body.permissionOverrides : null;
    const row = await prisma.adminRoleAssignment.upsert({
      where: { userId },
      create: { userId, roleCode, level: def.level, permissionOverrides: override, assignedBy: actor.user.id },
      update: { roleCode, level: def.level, permissionOverrides: override, assignedBy: actor.user.id },
    });
    await auditRequest(request, actor.user.id, "ADMIN_ROLE_ASSIGN", "USER", userId, { roleCode, level: def.level, permissionOverrides: override });
    return NextResponse.json({ ok: true, assignment: row });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: NextRequest) {
  try {
    const actor = await requirePermission("roles.manage");
    const userId = new URL(request.url).searchParams.get("userId") || "";
    if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, nickname: true, steamId: true } });
    if (!target) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
    if (isProtectedFounder(target)) return NextResponse.json({ error: "Founder защищён" }, { status: 403 });
    await prisma.adminRoleAssignment.deleteMany({ where: { userId } });
    await auditRequest(request, actor.user.id, "ADMIN_ROLE_REMOVE", "USER", userId, {});
    return NextResponse.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
