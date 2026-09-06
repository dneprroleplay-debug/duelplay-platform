import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { notificationCursor, notificationPageLimit, notificationStatus } from "@/lib/notification-policy";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ notifications: [], unread: 0, nextCursor: null });

  const limit = notificationPageLimit(request.nextUrl.searchParams.get("limit"));
  const before = notificationCursor(request.nextUrl.searchParams.get("before"));
  let cursorCreatedAt: Date | undefined;
  if (before) {
    const cursor = await prisma.notification.findFirst({ where: { id: before, userId: user.id }, select: { createdAt: true } });
    if (!cursor) return NextResponse.json({ error: "Invalid notification cursor" }, { status: 400 });
    cursorCreatedAt = cursor.createdAt;
  }

  const [notifications, unread] = await Promise.all([
    prisma.notification.findMany({
      where: {
        userId: user.id,
        status: { not: "ARCHIVED" },
        ...(cursorCreatedAt ? { createdAt: { lt: cursorCreatedAt } } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: { id: true, type: true, status: true, title: true, body: true, payload: true, createdAt: true, readAt: true },
    }),
    prisma.notification.count({ where: { userId: user.id, status: "UNREAD" } }),
  ]);

  const hasMore = notifications.length > limit;
  const page = hasMore ? notifications.slice(0, limit) : notifications;
  return NextResponse.json({ notifications: page, unread, nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null });
}

export async function PATCH(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || (body.all ? "readAll" : body.id ? "read" : ""));
  const now = new Date();

  if (action === "readAll") {
    const result = await prisma.notification.updateMany({
      where: { userId: user.id, status: "UNREAD" },
      data: { status: "READ", readAt: now },
    });
    return NextResponse.json({ ok: true, updated: result.count });
  }

  const id = String(body.id || "").trim();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  if (action === "read") {
    const result = await prisma.notification.updateMany({
      where: { id, userId: user.id, status: "UNREAD" },
      data: { status: "READ", readAt: now },
    });
    return NextResponse.json({ ok: result.count === 1, updated: result.count });
  }

  if (action === "archive") {
    const result = await prisma.notification.updateMany({
      where: { id, userId: user.id, status: { not: "ARCHIVED" } },
      data: { status: "ARCHIVED", readAt: now },
    });
    return NextResponse.json({ ok: result.count === 1, updated: result.count });
  }

  if (action === "setStatus") {
    const status = notificationStatus(body.status);
    if (!status || status === "UNREAD") return NextResponse.json({ error: "Unsupported notification status" }, { status: 400 });
    const result = await prisma.notification.updateMany({
      where: { id, userId: user.id, status: { not: "ARCHIVED" } },
      data: { status, readAt: now },
    });
    return NextResponse.json({ ok: result.count === 1, updated: result.count });
  }

  return NextResponse.json({ error: "Unknown notification action" }, { status: 400 });
}

export const dynamic = "force-dynamic";
