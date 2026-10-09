import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/auth";
import { ADMIN_INVITE_PREFIX, newAdminInviteToken } from "@/lib/admin-auth";
import { ADMIN_ROLE_DEFINITIONS, ADMIN_ROLE_CODES, requireAdminAccess, requirePermission, hasPermission, isProtectedFounder } from "@/lib/admin-rbac";
import { auditRequest } from "@/lib/admin";

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "ADMIN_LOGIN_REQUIRED") return NextResponse.json({ error: "Требуется вход администратора", errorCode: code }, { status: 401 });
  if (code === "ADMIN_MFA_SETUP_REQUIRED") return NextResponse.json({ error: "Требуется настроить MFA администратора", errorCode: code }, { status: 403 });
  if (code === "ADMIN_MFA_REQUIRED") return NextResponse.json({ error: "Требуется подтверждение MFA администратора", errorCode: code }, { status: 403 });
  return NextResponse.json({ error: "Недостаточно прав", errorCode: code || "FORBIDDEN" }, { status: 403 });
}

export async function GET() {
  try {
    const access = await requireAdminAccess();
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
    if (roleCode === "FOUNDER") return NextResponse.json({ error: "Founder 999 определяется защищённым аккаунтом владельца и не назначается через список ролей." }, { status: 403 });
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, nickname: true, steamId: true, role: true, status: true, passwordHash: true } });
    if (!target) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
    if (target.id === actor.user.id) return NextResponse.json({ error: "Нельзя изменять собственную роль" }, { status: 403 });
    if (isProtectedFounder(target)) return NextResponse.json({ error: "Founder защищён" }, { status: 403 });
    if (target.status !== "ACTIVE") return NextResponse.json({ error: "Сначала активируйте аккаунт пользователя, затем назначайте административную роль." }, { status: 409 });

    const def = ADMIN_ROLE_DEFINITIONS[roleCode];
    const override = body.permissionOverrides && typeof body.permissionOverrides === "object" && !Array.isArray(body.permissionOverrides) ? body.permissionOverrides : null;
    let adminInviteUrl: string | undefined;
    const row = await prisma.$transaction(async tx => {
      const assignment = await tx.adminRoleAssignment.upsert({
        where: { userId },
        create: { userId, roleCode, level: def.level, permissionOverrides: override, assignedBy: actor.user.id },
        update: { roleCode, level: def.level, permissionOverrides: override, assignedBy: actor.user.id },
      });

      // Reuse the existing one-time invitation flow for accounts without an admin password.
      // The invitation is bound to this existing User/Steam identity; no new account is created.
      if (!target.passwordHash) {
        const inviteToken = newAdminInviteToken();
        await tx.userSession.updateMany({
          where: { userId, isRevoked: false, ipAddress: "ADMIN_INVITE" },
          data: { isRevoked: true },
        });
        await tx.userSession.create({
          data: {
            userId,
            token: `${ADMIN_INVITE_PREFIX}${hashToken(inviteToken)}`,
            ipAddress: "ADMIN_INVITE",
            userAgent: "admin-rbac-role-invite",
            expiresAt: new Date(Date.now() + 30 * 60_000),
          },
        });
        adminInviteUrl = new URL(`/admin/setup?token=${inviteToken}`, request.url).toString();
      }

      return assignment;
    });
    await auditRequest(request, actor.user.id, "ADMIN_ROLE_ASSIGN", "USER", userId, { roleCode, level: def.level, permissionOverrides: override, adminInviteIssued: Boolean(adminInviteUrl) });
    return NextResponse.json({ ok: true, assignment: row, adminInviteUrl });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: NextRequest) {
  try {
    const actor = await requirePermission("roles.manage");
    const userId = new URL(request.url).searchParams.get("userId") || "";
    if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
    if (userId === actor.user.id) return NextResponse.json({ error: "Нельзя изменять собственный уровень доступа" }, { status: 403 });
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, nickname: true, steamId: true, role: true } });
    if (!target) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
    if (isProtectedFounder(target)) return NextResponse.json({ error: "Founder защищён" }, { status: 403 });
    await prisma.$transaction(async tx => {
      await tx.adminRoleAssignment.deleteMany({ where: { userId } });
      await tx.userSession.updateMany({
        where: { userId, isRevoked: false, ipAddress: "ADMIN_INVITE" },
        data: { isRevoked: true },
      });
      // resolveAdminAccess falls back to legacy User.role when there is no RBAC assignment.
      // Clear legacy admin roles too, otherwise removing RBAC could accidentally restore access.
      if (["SUPPORT", "MODERATOR", "ADMIN", "SUPERADMIN"].includes(target.role)) {
        await tx.user.update({ where: { id: userId }, data: { role: "USER" } });
      }
    });
    await auditRequest(request, actor.user.id, "ADMIN_ROLE_REMOVE", "USER", userId, {});
    return NextResponse.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
