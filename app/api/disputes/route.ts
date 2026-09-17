import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { requireAdmin, audit } from "@/lib/admin";
import { isModeratorRole } from "@/lib/role-policy";
import { creditWallet } from "@/lib/wallet";
import { awardXp, updateMatchProgress, updateRatingAfterDuel } from "@/lib/progression";

const DECISIONS = ["DRAW", "WINNER_PLAYER_ONE", "WINNER_PLAYER_TWO", "CANCELLED_REFUND"] as const;
const EVIDENCE_TYPES = ["IMAGE", "VIDEO", "LOG_FILE", "DEMO_REPLAY"] as const;
type Decision = typeof DECISIONS[number];

function isDecision(value: string): value is Decision { return (DECISIONS as readonly string[]).includes(value); }
function isEvidenceType(value: string): boolean { return (EVIDENCE_TYPES as readonly string[]).includes(value); }

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const isAdmin = isModeratorRole(me.role);
  const disputes = await prisma.dispute.findMany({
    where: isAdmin ? undefined : { reporterId: me.id },
    orderBy: { createdAt: "desc" },
    take: isAdmin ? 100 : 50,
    include: {
      match: { select: { id: true, status: true, mapName: true, playerOneId: true, playerTwoId: true } },
      reporter: { select: { id: true, nickname: true } },
      evidences: true,
    },
  });
  return NextResponse.json(disputes);
}

export async function POST(request: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const matchId = String(body.matchId || "").trim();
  const reason = String(body.reason || "").trim();
  if (!matchId || reason.length < 10) return NextResponse.json({ error: "Match and a meaningful reason are required" }, { status: 400 });
  if (reason.length > 3000) return NextResponse.json({ error: "Reason is too long" }, { status: 400 });

  try {
    const dispute = await prisma.$transaction(async tx => {
      const matches = await tx.$queryRaw<Array<{ id: string; playerOneId: string; playerTwoId: string | null; status: string }>>`
        SELECT id, "playerOneId", "playerTwoId", status FROM "Match" WHERE id = ${matchId} FOR UPDATE
      `;
      const match = matches[0];
      if (!match || ![match.playerOneId, match.playerTwoId].includes(me.id)) throw new Error("NOT_PARTICIPANT");
      if (!["FINISHED", "DISPUTED"].includes(match.status)) throw new Error("MATCH_NOT_DISPUTABLE");
      if (match.status === "DISPUTED") throw new Error("ALREADY_DISPUTED");

      const recent = await tx.dispute.findFirst({ where: { matchId, reporterId: me.id, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, status: { in: ["OPEN", "UNDER_REVIEW", "AI_PROCESSED"] } } });
      if (recent) throw new Error("DUPLICATE_DISPUTE");

      const created = await tx.dispute.create({ data: { matchId, reporterId: me.id, reason, status: "OPEN" } });
      await tx.match.update({ where: { id: matchId }, data: { status: "DISPUTED" } });
      return created;
    });
    await audit(me.id, "CREATE_DISPUTE", "DISPUTE", dispute.id, { matchId });
    return NextResponse.json(dispute, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const map: Record<string, [string, number]> = {
      NOT_PARTICIPANT: ["You are not a participant", 403],
      MATCH_NOT_DISPUTABLE: ["Only finished matches can be disputed", 409],
      ALREADY_DISPUTED: ["Match already has an active dispute", 409],
      DUPLICATE_DISPUTE: ["You already have an open dispute for this match", 409],
    };
    if (map[code]) return NextResponse.json({ error: map[code][0] }, { status: map[code][1] });
    console.error(error); return NextResponse.json({ error: "Failed to create dispute" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "");

  if (action === "evidence") {
    const me = await getCurrentUser();
    if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const id = String(body.id || "");
    const fileUrl = String(body.fileUrl || "").trim();
    const type = String(body.type || "IMAGE");
    if (!id || !fileUrl || fileUrl.length > 2048 || !isEvidenceType(type)) return NextResponse.json({ error: "Invalid evidence" }, { status: 400 });
    const row = await prisma.$transaction(async tx => {
      const d = await tx.dispute.findUnique({ where: { id }, include: { match: { select: { playerOneId: true, playerTwoId: true } } } });
      if (!d || ![d.reporterId, d.match.playerOneId, d.match.playerTwoId].includes(me.id)) throw new Error("FORBIDDEN");
      if (!["OPEN", "UNDER_REVIEW", "AI_PROCESSED"].includes(d.status)) throw new Error("CLOSED");
      const count = await tx.matchEvidence.count({ where: { disputeId: id } });
      if (count >= 10) throw new Error("EVIDENCE_LIMIT");
      return tx.matchEvidence.create({ data: { disputeId: id, uploadedById: me.id, type: type as never, fileUrl, metadata: body.metadata ?? null } });
    }).catch(error => { throw error; });
    return NextResponse.json(row, { status: 201 });
  }

  const me = await requireAdmin(2);
  const id = String(body.id || "");
  const decisionValue = String(body.decision || "");
  if (!id || !isDecision(decisionValue)) return NextResponse.json({ error: "Invalid dispute decision" }, { status: 400 });

  try {
    const result = await prisma.$transaction(async tx => {
      const disputes = await tx.$queryRaw<Array<any>>`
        SELECT id, "matchId", "reporterId", status, "adminDecision" FROM "Dispute" WHERE id = ${id} FOR UPDATE
      `;
      const d = disputes[0];
      if (!d) throw new Error("NOT_FOUND");
      if (["RESOLVED_BY_ADMIN", "CLOSED"].includes(d.status)) return { id: d.id, idempotent: true };

      const matches = await tx.$queryRaw<Array<any>>`SELECT * FROM "Match" WHERE id = ${d.matchId} FOR UPDATE`;
      const match = matches[0];
      if (!match || match.status !== "DISPUTED") throw new Error("MATCH_STATE");
      const stake = Number(match.betAmount);
      if (!Number.isFinite(stake) || stake <= 0) throw new Error("INVALID_STAKE");
      const p1 = String(match.playerOneId), p2 = String(match.playerTwoId || "");
      if (!p2) throw new Error("INVALID_PLAYERS");

      const wallets = await tx.$queryRaw<Array<{ id: string; userId: string; lockedBalance: any }>>`
        SELECT id, "userId", "lockedBalance" FROM "Wallet" WHERE "userId" IN (${p1}, ${p2}) FOR UPDATE
      `;
      const w1 = wallets.find(w => w.userId === p1), w2 = wallets.find(w => w.userId === p2);
      if (!w1 || !w2 || Number(w1.lockedBalance) < stake || Number(w2.lockedBalance) < stake) throw new Error("LOCKED_STAKE");

      const winnerId = decisionValue === "WINNER_PLAYER_ONE" ? p1 : decisionValue === "WINNER_PLAYER_TWO" ? p2 : null;
      const loserId = winnerId ? (winnerId === p1 ? p2 : p1) : null;
      if (winnerId) {
        const payout = Math.max(0, Number((stake * 2 - Number(match.commission)).toFixed(4)));
        const credited = await creditWallet(tx, winnerId, payout, `dispute-win:${id}`, "MATCH_WIN", "Dispute resolution payout", match.id);
        if (!credited.idempotent) {
          await tx.wallet.update({ where: { id: w1.id }, data: { lockedBalance: { decrement: stake } } });
          await tx.wallet.update({ where: { id: w2.id }, data: { lockedBalance: { decrement: stake } } });
          await awardXp(tx, winnerId, 100); await awardXp(tx, loserId!, 25);
          await updateMatchProgress(tx, winnerId, true); await updateMatchProgress(tx, loserId!, false);
          await updateRatingAfterDuel(tx, winnerId, loserId!);
        }
      } else {
        for (const userId of [p1, p2]) {
          const wallet = userId === p1 ? w1 : w2;
          const credited = await creditWallet(tx, userId, stake, `dispute-refund:${id}:${userId}`, "REFUND", "Dispute resolution refund", match.id);
          if (!credited.idempotent) await tx.wallet.update({ where: { id: wallet.id }, data: { lockedBalance: { decrement: stake } } });
        }
      }

      const updatedMatch = await tx.match.update({ where: { id: match.id }, data: { status: winnerId ? "FINISHED" : "CANCELLED", winnerId, loserId, endedAt: new Date(), connectionPhaseCompleted: true } });
      const updatedDispute = await tx.dispute.update({ where: { id }, data: { adminDecision: decisionValue, status: "RESOLVED_BY_ADMIN", adminNotes: String(body.notes || "").slice(0, 2000), resolvedAt: new Date() } });
      return { dispute: updatedDispute, match: updatedMatch, idempotent: false };
    });
    if (!result.idempotent) await audit(me.id, "RESOLVE_DISPUTE", "DISPUTE", id, { decision: decisionValue });
    return NextResponse.json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const map: Record<string, [string, number]> = { NOT_FOUND: ["Dispute not found", 404], MATCH_STATE: ["Match is not awaiting dispute resolution", 409], LOCKED_STAKE: ["Locked stake is unavailable", 409], INVALID_STAKE: ["Invalid match stake", 409], INVALID_PLAYERS: ["Match has invalid players", 409] };
    if (map[code]) return NextResponse.json({ error: map[code][0] }, { status: map[code][1] });
    console.error(error); return NextResponse.json({ error: "Failed to resolve dispute" }, { status: 500 });
  }
}
