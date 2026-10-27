import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminAccess, requirePermission } from "@/lib/admin-rbac";
import { getPresenceCutoff } from "@/lib/presence";
import { Prisma } from "@prisma/client";

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "ADMIN_LOGIN_REQUIRED") return NextResponse.json({ error: "Требуется вход администратора", errorCode: code }, { status: 401 });
  if (code === "ADMIN_MFA_SETUP_REQUIRED") return NextResponse.json({ error: "Требуется настроить MFA администратора", errorCode: code }, { status: 403 });
  if (code === "ADMIN_MFA_REQUIRED") return NextResponse.json({ error: "Требуется подтверждение MFA администратора", errorCode: code }, { status: 403 });
  return NextResponse.json({ error: "Недостаточно прав", errorCode: code || "FORBIDDEN" }, { status: 403 });
}

export async function GET(request: NextRequest) {
  try {
    await requireAdminAccess();
    await requirePermission("users.view");

    const searchParams = request.nextUrl.searchParams;
    const filter = String(searchParams.get("filter") || "all").toLowerCase();
    const search = String(searchParams.get("search") || "").trim();
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10) || 20));

    const now = new Date();
    const cutoff = getPresenceCutoff(now);

    // Online sessions: active within PRESENCE_THRESHOLD_MS (120s), unrevoked, unexpired
    const onlineSessions = await prisma.userSession.findMany({
      where: {
        isRevoked: false,
        expiresAt: { gt: now },
        lastActiveAt: { gte: cutoff },
      },
      select: { userId: true },
      distinct: ["userId"],
    });

    const onlineSet = new Set(onlineSessions.map((s) => s.userId));
    const onlineCount = onlineSet.size;
    const totalUsers = await prisma.user.count({ where: { deletedAt: null } });
    const offlineCount = Math.max(0, totalUsers - onlineCount);

    const onlineIdsArray = Array.from(onlineSet);

    const where: Prisma.UserWhereInput = {
      deletedAt: null,
    };

    if (search) {
      where.nickname = { contains: search, mode: "insensitive" };
    }

    if (filter === "online") {
      where.id = { in: onlineIdsArray };
    } else if (filter === "offline") {
      where.id = { notIn: onlineIdsArray };
    }

    const filteredCount = await prisma.user.count({ where });
    const totalPages = Math.ceil(filteredCount / limit) || 1;
    const safePage = Math.min(page, totalPages);

    const users = await prisma.user.findMany({
      where,
      skip: (safePage - 1) * limit,
      take: limit,
      select: {
        id: true,
        nickname: true,
        avatarUrl: true,
        steamAvatarUrl: true,
        role: true,
        status: true,
      },
      orderBy: { nickname: "asc" },
    });

    const userIds = users.map((u) => u.id);
    const latestSessions = userIds.length
      ? await prisma.userSession.groupBy({
          by: ["userId"],
          where: { userId: { in: userIds }, isRevoked: false },
          _max: { lastActiveAt: true },
        })
      : [];

    const lastActiveMap = new Map(latestSessions.map((s) => [s.userId, s._max.lastActiveAt]));

    const items = users.map((u) => ({
      id: u.id,
      nickname: u.nickname,
      avatarUrl: u.avatarUrl || u.steamAvatarUrl || "/images/avatar-placeholder.svg",
      role: u.role,
      status: u.status,
      online: onlineSet.has(u.id),
      lastActiveAt: lastActiveMap.get(u.id)?.toISOString() ?? null,
    }));

    return NextResponse.json(
      {
        totalUsers,
        onlineCount,
        offlineCount,
        page: safePage,
        limit,
        totalPages,
        totalFiltered: filteredCount,
        users: items,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
