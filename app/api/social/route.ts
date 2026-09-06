import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [relations, mutes, rivals] = await Promise.all([
    prisma.friend.findMany({
      where: { OR: [{ senderId: me.id }, { receiverId: me.id }] },
      include: {
        sender: { select: { id: true, nickname: true, avatarUrl: true, status: true } },
        receiver: { select: { id: true, nickname: true, avatarUrl: true, status: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.userMute.findMany({
      where: { userId: me.id },
      include: { mutedUser: { select: { id: true, nickname: true, avatarUrl: true, status: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.rival.findMany({
      where: { ownerId: me.id, status: "ACTIVE" },
      include: { target: { select: { id: true, nickname: true, avatarUrl: true } } },
    }),
  ]);

  const accepted = relations.filter((x) => x.status === "ACCEPTED");
  const normalizedFriends = accepted.map((x) => ({ ...x, person: x.senderId === me.id ? x.receiver : x.sender }));
  const pendingIncoming = relations.filter((x) => x.receiverId === me.id && x.status === "PENDING");
  const pendingOutgoing = relations.filter((x) => x.senderId === me.id && x.status === "PENDING");
  const blocked = relations.filter((x) => x.status === "BLOCKED" && x.senderId === me.id);

  const unreadMessages = await prisma.socialMessage.count({ where: { receiverId: me.id, readAt: null } });
  return NextResponse.json({ friends: normalizedFriends, rivals, pendingIncoming, pendingOutgoing, blocked, mutes, unreadMessages });
}

export async function POST(r: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { action?: unknown; targetId?: unknown };
  try { body = await r.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const action = String(body.action || "");
  const targetId = String(body.targetId || "");
  if (!targetId || targetId === me.id) return NextResponse.json({ error: "Invalid target" }, { status: 400 });
  if (!["mute", "unmute", "block", "unblock"].includes(action)) return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, status: true } });
  if (!target || target.status !== "ACTIVE") return NextResponse.json({ error: "Target unavailable" }, { status: 404 });

  if (action === "mute") return NextResponse.json(await prisma.userMute.upsert({ where: { userId_mutedUserId: { userId: me.id, mutedUserId: targetId } }, update: {}, create: { userId: me.id, mutedUserId: targetId } }));
  if (action === "unmute") { await prisma.userMute.deleteMany({ where: { userId: me.id, mutedUserId: targetId } }); return NextResponse.json({ ok: true }); }

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT "id" FROM "User"
      WHERE "id" IN (${me.id}::uuid, ${targetId}::uuid)
      ORDER BY "id"
      FOR UPDATE
    `;
    const relations = await tx.friend.findMany({
      where: { OR: [{ senderId: me.id, receiverId: targetId }, { senderId: targetId, receiverId: me.id }] },
      select: { id: true },
    });
    if (action === "block") {
      if (relations.length) await tx.friend.deleteMany({ where: { id: { in: relations.map((x) => x.id) } } });
      await tx.friend.create({ data: { senderId: me.id, receiverId: targetId, status: "BLOCKED" } });
      await tx.userMute.upsert({
        where: { userId_mutedUserId: { userId: me.id, mutedUserId: targetId } },
        update: {},
        create: { userId: me.id, mutedUserId: targetId },
      });
      return;
    }
    const row = await tx.friend.findFirst({ where: { senderId: me.id, receiverId: targetId, status: "BLOCKED" } });
    if (row) await tx.friend.delete({ where: { id: row.id } });
    await tx.userMute.deleteMany({ where: { userId: me.id, mutedUserId: targetId } });
  });
  return NextResponse.json({ ok: true });
}
