import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { enforceRateLimit } from "@/lib/rate-limit";

const FRIEND_SELECT = {
  id: true,
  senderId: true,
  receiverId: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  sender: { select: { id: true, nickname: true, avatarUrl: true, status: true } },
  receiver: { select: { id: true, nickname: true, avatarUrl: true, status: true } },
} as const;

type FriendAction = "add" | "accept" | "decline" | "remove" | "block" | "unblock";

async function lockUsers(tx: Prisma.TransactionClient, firstId: string, secondId: string) {
  await tx.$queryRaw`
    SELECT "id" FROM "User"
    WHERE "id" IN (${firstId}::uuid, ${secondId}::uuid)
    ORDER BY "id"
    FOR UPDATE
  `;
}

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await prisma.friend.findMany({
    where: { OR: [{ senderId: me.id }, { receiverId: me.id }] },
    select: FRIEND_SELECT,
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(rows);
}

export async function POST(r: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { userId?: unknown; action?: unknown };
  try {
    body = await r.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const userId = String(body.userId || "");
  const action = String(body.action || "add") as FriendAction;
  const actions: FriendAction[] = ["add", "accept", "decline", "remove", "block", "unblock"];
  if (!actions.includes(action)) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  if (!userId || userId === me.id) return NextResponse.json({ error: "Invalid user" }, { status: 400 });

  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockUsers(tx, me.id, userId);

      const target = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, nickname: true, status: true },
      });
      if (!target || target.status !== "ACTIVE") throw new Error("USER_UNAVAILABLE");

      const relations = await tx.friend.findMany({
        where: { OR: [{ senderId: me.id, receiverId: userId }, { senderId: userId, receiverId: me.id }] },
        orderBy: { updatedAt: "desc" },
      });
      const outgoing = relations.find((x) => x.senderId === me.id && x.receiverId === userId);
      const incoming = relations.find((x) => x.senderId === userId && x.receiverId === me.id);
      const existing = relations[0];

      if (action === "add") {
        await enforceRateLimit(tx, me.id, "FRIEND_REQUEST", 20, 60_000);

        if (relations.some((x) => x.status === "BLOCKED")) throw new Error("BLOCKED");
        const muted = await tx.userMute.findFirst({
          where: { OR: [{ userId: me.id, mutedUserId: userId }, { userId, mutedUserId: me.id }] },
          select: { id: true },
        });
        if (muted) throw new Error("BLOCKED");
        if (outgoing?.status === "PENDING") return { kind: "existing", row: outgoing };
        if (incoming?.status === "PENDING") throw new Error("INCOMING_PENDING");
        if (existing?.status === "ACCEPTED") return { kind: "existing", row: existing };

        // Clean up stale directional records so there is one active relationship.
        if (relations.length) await tx.friend.deleteMany({ where: { id: { in: relations.map((x) => x.id) } } });
        const row = await tx.friend.create({
          data: { senderId: me.id, receiverId: userId, status: "PENDING" },
          select: FRIEND_SELECT,
        });
        await tx.notification.create({
          data: {
            userId,
            type: "SYSTEM",
            status: "UNREAD",
            title: "Friend request",
            body: `${me.nickname} sent you a friend request.`,
            payload: { kind: "FRIEND_REQUEST", friendId: row.id },
          },
        });
        return { kind: "created", row };
      }

      if (action === "accept") {
        if (!incoming || incoming.status !== "PENDING") throw new Error("REQUEST_NOT_FOUND");
        const updated = await tx.friend.update({ where: { id: incoming.id }, data: { status: "ACCEPTED" }, select: FRIEND_SELECT });
        await tx.notification.create({
          data: {
            userId: incoming.senderId,
            type: "SYSTEM",
            status: "UNREAD",
            title: "Friend request accepted",
            body: `${me.nickname} accepted your friend request.`,
            payload: { kind: "FRIEND_ACCEPTED", friendId: incoming.id },
          },
        });
        return { kind: "updated", row: updated };
      }

      if (action === "decline") {
        if (!incoming || incoming.status !== "PENDING") throw new Error("REQUEST_NOT_FOUND");
        await tx.friend.delete({ where: { id: incoming.id } });
        return { kind: "declined", row: null };
      }

      if (action === "remove") {
        // A sender may cancel their own pending request; an accepted relationship may be removed by either side.
        const removable = relations.find(
          (x) => x.status === "ACCEPTED" || (x.status === "PENDING" && x.senderId === me.id),
        );
        if (removable) await tx.friend.delete({ where: { id: removable.id } });
        return { kind: "removed", row: null };
      }

      if (action === "block") {
        await tx.friend.deleteMany({ where: { id: { in: relations.map((x) => x.id) } } });
        const row = await tx.friend.create({
          data: { senderId: me.id, receiverId: userId, status: "BLOCKED" },
          select: FRIEND_SELECT,
        });
        await tx.userMute.upsert({
          where: { userId_mutedUserId: { userId: me.id, mutedUserId: userId } },
          update: {},
          create: { userId: me.id, mutedUserId: userId },
        });
        return { kind: "blocked", row };
      }

      // Unblock removes only the block created by the current user.
      if (existing?.status === "BLOCKED" && existing.senderId === me.id) {
        await tx.friend.delete({ where: { id: existing.id } });
      }
      await tx.userMute.deleteMany({ where: { userId: me.id, mutedUserId: userId } });
      return { kind: "unblocked", row: null };
    });

    return NextResponse.json(result.row ?? { ok: true }, { status: result.kind === "created" ? 201 : 200 });
  } catch (error: unknown) {
    const code = error instanceof Error ? error.message : "";
    if (code === "USER_UNAVAILABLE") return NextResponse.json({ error: "User unavailable" }, { status: 404 });
    if (code === "BLOCKED") return NextResponse.json({ error: "Friend requests are unavailable for this user" }, { status: 403 });
    if (code === "INCOMING_PENDING") return NextResponse.json({ error: "This user already sent you a friend request" }, { status: 409 });
    if (code === "REQUEST_NOT_FOUND") return NextResponse.json({ error: "Request not found" }, { status: 404 });
    if (code === "RATE_LIMITED") return NextResponse.json({ error: "Too many friend requests. Please try later." }, { status: 429 });
    console.error("friends route failed", error);
    return NextResponse.json({ error: "Friend operation failed" }, { status: 500 });
  }
}
