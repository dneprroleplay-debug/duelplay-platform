import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { enforceRateLimit } from "@/lib/rate-limit";
import { assertAbuseGuard } from "@/lib/anti-fraud";

const PERSON_SELECT = { id: true, nickname: true, avatarUrl: true } as const;

export async function GET(r: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let other = new URL(r.url).searchParams.get("userId");
  if (other) {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(other)) {
      const u = await prisma.user.findUnique({ where: { nickname: other }, select: { id: true } });
      if (!u) return NextResponse.json({ error: "User unavailable" }, { status: 404 });
      other = u.id;
    }
  }
  if (other === me.id) return NextResponse.json({ error: "Invalid conversation" }, { status: 400 });
  const where = other
    ? { OR: [{ senderId: me.id, receiverId: other }, { senderId: other, receiverId: me.id }] }
    : { OR: [{ senderId: me.id }, { receiverId: me.id }] };
  const rows = await prisma.socialMessage.findMany({
    where, orderBy: { createdAt: "asc" }, take: 200,
    include: { sender: { select: PERSON_SELECT }, receiver: { select: PERSON_SELECT } },
  });
  return NextResponse.json(rows);
}

export async function PATCH(r: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await r.json().catch(() => ({}));
  // Mark exactly one conversation as read. Opening a chat must not silently
  // clear every other unread conversation.
  const fromUserId = String(b.fromUserId || "").trim();
  if (fromUserId) {
    if (fromUserId === me.id) return NextResponse.json({ error: "Invalid conversation" }, { status: 400 });
    const marked = await prisma.socialMessage.updateMany({
      where: { receiverId: me.id, senderId: fromUserId, readAt: null },
      data: { readAt: new Date() },
    });
    await prisma.notification.updateMany({
      where: {
        userId: me.id,
        status: "UNREAD",
        payload: { path: ["kind"], equals: "SOCIAL_MESSAGE" },
        AND: [{ payload: { path: ["senderId"], equals: fromUserId } }],
      },
      data: { status: "READ", readAt: new Date() },
    });
    return NextResponse.json({ ok: true, updated: marked.count });
  }
  if (b.all) {
    await prisma.socialMessage.updateMany({ where: { receiverId: me.id, readAt: null }, data: { readAt: new Date() } });
    await prisma.notification.updateMany({
      where: {
        userId: me.id,
        status: "UNREAD",
        payload: { path: ["kind"], equals: "SOCIAL_MESSAGE" },
      },
      data: { status: "READ", readAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  }
  const id = String(b.id || "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const row = await prisma.socialMessage.updateMany({ where: { id, receiverId: me.id, readAt: null }, data: { readAt: new Date() } });
  return NextResponse.json({ ok: row.count === 1 });
}

export async function POST(r: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await r.json().catch(() => ({}));
  let receiverId = String(b.receiverId || "").trim();
  const raw = typeof b.body === "string" ? b.body : "";
  const body = raw.replace(/\s+/g, " ").trim().slice(0, 2000);
  if (!receiverId || !body) return NextResponse.json({ error: "Invalid message" }, { status: 400 });

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(receiverId)) {
    const u = await prisma.user.findUnique({ where: { nickname: receiverId }, select: { id: true } });
    if (!u) return NextResponse.json({ error: "Recipient unavailable" }, { status: 404 });
    receiverId = u.id;
  }
  if (receiverId === me.id) return NextResponse.json({ error: "Invalid message" }, { status: 400 });

  try {
    const message = await prisma.$transaction(async (tx) => {
      await assertAbuseGuard(tx, me.id, "MESSAGE_SEND");
      await enforceRateLimit(tx, me.id, "MESSAGE_SEND", 20, 60_000);
      await enforceRateLimit(tx, me.id, `MESSAGE_TO:${receiverId}`, 5, 60_000);
      const receiver = await tx.user.findUnique({ where: { id: receiverId }, select: { id: true, nickname: true, status: true, allowMessages: true } });
      if (!receiver || receiver.status !== "ACTIVE") throw new Error("RECIPIENT_UNAVAILABLE");
      if (!receiver.allowMessages) throw new Error("MESSAGES_DISABLED");
      const blocked = await tx.friend.findFirst({
        where: { status: "BLOCKED", OR: [{ senderId: me.id, receiverId }, { senderId: receiverId, receiverId: me.id }] },
        select: { id: true },
      });
      if (blocked) throw new Error("BLOCKED");
      const muted = await tx.userMute.findFirst({
        where: { OR: [{ userId: receiverId, mutedUserId: me.id }, { userId: me.id, mutedUserId: receiverId }] },
        select: { id: true },
      });
      if (muted) throw new Error("MESSAGING_DISABLED");
      const created = await tx.socialMessage.create({
        data: { senderId: me.id, receiverId, body },
        include: { sender: { select: PERSON_SELECT }, receiver: { select: PERSON_SELECT } },
      });
      await tx.notification.create({
        data: {
          userId: receiverId, type: "SYSTEM", status: "UNREAD", title: "New message",
          body: `${me.nickname} sent you a message.`,
          payload: { kind: "SOCIAL_MESSAGE", messageId: created.id, senderId: me.id, senderNickname: me.nickname },
        },
      });
      return created;
    });
    return NextResponse.json(message, { status: 201 });
  } catch (e) {
    const code = e instanceof Error ? e.message : "";
    if (code === "RATE_LIMITED") return NextResponse.json({ error: "Too many messages. Please try later." }, { status: 429 });
    if (code === "RECIPIENT_UNAVAILABLE") return NextResponse.json({ error: "Recipient unavailable" }, { status: 404 });
    if (code === "MESSAGES_DISABLED") return NextResponse.json({ error: "Recipient does not accept messages" }, { status: 403 });
    if (code === "BLOCKED" || code === "MESSAGING_DISABLED") return NextResponse.json({ error: "Messaging disabled" }, { status: 403 });
    console.error("messages route failed", e);
    return NextResponse.json({ error: "Message send failed" }, { status: 500 });
  }
}
