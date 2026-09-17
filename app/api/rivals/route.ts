import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { enforceRateLimit } from "@/lib/rate-limit";

const RIVAL_SELECT = {
  id: true,
  ownerId: true,
  targetId: true,
  status: true,
  createdAt: true,
  target: { select: { id: true, nickname: true, avatarUrl: true, status: true } },
} as const;

type RivalAction = "add" | "remove" | "rematch";

async function lockUsers(tx: Prisma.TransactionClient, firstId: string, secondId: string) {
  await tx.$queryRaw`
    SELECT "id" FROM "User"
    WHERE "id" IN (${firstId}::uuid, ${secondId}::uuid)
    ORDER BY "id"
    FOR UPDATE
  `;
}

async function getActiveRival(tx: Prisma.TransactionClient, ownerId: string, targetId: string) {
  return tx.rival.findUnique({
    where: { ownerId_targetId: { ownerId, targetId } },
    select: RIVAL_SELECT,
  });
}

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await prisma.rival.findMany({
    where: { ownerId: me.id, status: "ACTIVE", target: { status: "ACTIVE" } },
    select: RIVAL_SELECT,
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(rows);
}

export async function POST(r: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { targetId?: unknown; action?: unknown };
  try {
    body = await r.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const targetId = String(body.targetId || "");
  const action = String(body.action || "add") as RivalAction;
  if (!targetId || targetId === me.id) return NextResponse.json({ error: "Invalid target" }, { status: 400 });
  if (!["add", "remove", "rematch"].includes(action)) return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockUsers(tx, me.id, targetId);

      const target = await tx.user.findUnique({
        where: { id: targetId },
        select: { id: true, nickname: true, avatarUrl: true, status: true, allowChallenges: true },
      });
      if (!target || target.status !== "ACTIVE") throw new Error("TARGET_UNAVAILABLE");

      const rival = await getActiveRival(tx, me.id, targetId);
      if (action === "add") {
        await enforceRateLimit(tx, me.id, "RIVAL_ADD", 30, 60_000);
        const blocked = await tx.friend.findFirst({
          where: {
            status: "BLOCKED",
            OR: [
              { senderId: me.id, receiverId: targetId },
              { senderId: targetId, receiverId: me.id },
            ],
          },
          select: { id: true },
        });
        if (blocked) throw new Error("BLOCKED");

        const row = await tx.rival.upsert({
          where: { ownerId_targetId: { ownerId: me.id, targetId } },
          update: { status: "ACTIVE" },
          create: { ownerId: me.id, targetId, status: "ACTIVE" },
          select: RIVAL_SELECT,
        });
        return { kind: "added", row };
      }

      if (action === "remove") {
        if (rival) {
          const row = await tx.rival.update({ where: { id: rival.id }, data: { status: "REMOVED" }, select: RIVAL_SELECT });
          return { kind: "removed", row };
        }
        return { kind: "removed", row: null };
      }

      // A rematch is deliberately routed through the existing Challenge flow.
      // This keeps stake locking, limits, expiry and acceptance rules in one place.
      if (!rival) throw new Error("NOT_RIVAL");
      if (!target.allowChallenges) throw new Error("CHALLENGES_DISABLED");
      return {
        kind: "rematch_ready",
        row: { targetId: target.id, nickname: target.nickname, avatarUrl: target.avatarUrl },
      };
    });

    return NextResponse.json(result.row ?? { ok: true, action: result.kind });
  } catch (error: unknown) {
    const code = error instanceof Error ? error.message : "";
    if (code === "TARGET_UNAVAILABLE") return NextResponse.json({ error: "Target unavailable" }, { status: 404 });
    if (code === "BLOCKED") return NextResponse.json({ error: "Rival is unavailable while the player is blocked" }, { status: 403 });
    if (code === "RATE_LIMITED") return NextResponse.json({ error: "Too many rival actions. Please try later." }, { status: 429 });
    if (code === "NOT_RIVAL") return NextResponse.json({ error: "Add this player as a rival first" }, { status: 409 });
    if (code === "CHALLENGES_DISABLED") return NextResponse.json({ error: "This player is not accepting challenges" }, { status: 409 });
    console.error("rivals route failed", error);
    return NextResponse.json({ error: "Rival operation failed" }, { status: 500 });
  }
}

export async function DELETE(r: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const targetId = String(r.nextUrl.searchParams.get("targetId") || "");
  if (!targetId || targetId === me.id) return NextResponse.json({ error: "Invalid target" }, { status: 400 });

  const result = await prisma.rival.updateMany({
    where: { ownerId: me.id, targetId, status: "ACTIVE" },
    data: { status: "REMOVED" },
  });
  return NextResponse.json({ ok: true, removed: result.count });
}
