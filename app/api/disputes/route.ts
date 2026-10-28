import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { auditRequest } from "@/lib/admin";
import { hasPermission, requirePermission, resolveAdminAccess } from "@/lib/admin-rbac";
import { creditWallet, releaseWalletHold } from "@/lib/wallet";
import { recordPlatformLedgerEntry } from "@/lib/finance";
import { awardXp, updateMatchProgress, updateRatingAfterDuel } from "@/lib/progression";
import { evaluateAndUnlockAchievements } from "@/lib/achievements";
import { enforceRateLimit } from "@/lib/rate-limit";
import { withDemoPolicyTransaction } from "@/lib/demo-policy";
import { notify } from "@/lib/notifications";
import { DISPUTE_REASON_TO_ERROR, evaluateDisputeEligibility } from "@/lib/dispute-eligibility";
import { Prisma } from "@prisma/client";

const DECISIONS = ["DRAW", "WINNER_PLAYER_ONE", "WINNER_PLAYER_TWO", "CANCELLED_REFUND"] as const;
import { EVIDENCE_TYPES, isEvidenceType, validateEvidenceFile } from "@/lib/dispute-evidence";
type Decision = typeof DECISIONS[number];

type DisputeLockRow = {
  id: string;
  matchId: string;
  reporterId: string;
  status: string;
  adminDecision: string | null;
};

type DisputeMatchRow = {
  id: string;
  status: string;
  economyMode: "REAL" | "DEMO";
  playerOneId: string;
  playerTwoId: string | null;
  betAmount: Prisma.Decimal;
  commission: Prisma.Decimal;
  weaponModifier: string | null;
};

function isDecision(value: string): value is Decision { return (DECISIONS as readonly string[]).includes(value); }

async function notifyDisputeUpdate(
  tx: Prisma.TransactionClient,
  userId: string,
  input: { matchId: string; economyMode: string; kind: "DISPUTE_OPENED" | "DISPUTE_RESOLVED"; role?: "REPORTER" | "OPPONENT"; decision?: string },
) {
  const opened = input.kind === "DISPUTE_OPENED";
  const title = opened ? "Dispute opened" : "Dispute resolved";
  const body = opened
    ? input.role === "OPPONENT"
      ? "Your opponent opened a dispute for this match. The result is under review."
      : "Your dispute has been submitted and is under review."
    : `The dispute has been resolved with decision ${input.decision}.`;
  await notify(tx, userId, "DISPUTE_UPDATE", title, body, {
    kind: input.kind,
    matchId: input.matchId,
    economyMode: input.economyMode,
    role: input.role,
    decision: input.decision,
  });
}

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await resolveAdminAccess(me.id);
  const isAdmin = Boolean(access && access.level > 0 && hasPermission(access.permissions, "disputes.view"));
  const canViewEvidence = !isAdmin || Boolean(access && hasPermission(access.permissions, "evidence.view"));
  const disputes = await prisma.dispute.findMany({
    where: isAdmin ? undefined : { OR: [{ reporterId: me.id }, { match: { OR: [{ playerOneId: me.id }, { playerTwoId: me.id }] } }] },
    orderBy: { createdAt: "desc" },
    take: isAdmin ? 100 : 50,
    include: {
      match: { select: { id: true, status: true, mapName: true, playerOneId: true, playerTwoId: true } },
      reporter: { select: { id: true, nickname: true } },
      evidences: true,
    },
  });
  return NextResponse.json(disputes.map(dispute => ({
    ...dispute,
    evidences: dispute.evidences.map(evidence => canViewEvidence ? evidence : {
      id: evidence.id,
      disputeId: evidence.disputeId,
      uploadedById: evidence.uploadedById,
      type: evidence.type,
      fileUrl: null,
      metadata: null,
      createdAt: evidence.createdAt,
    }),
  })));
}

export async function POST(request: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await prisma.$transaction(tx => enforceRateLimit(tx, me.id, "DISPUTE_CREATE", 10, 10 * 60_000));
  } catch (error) {
    if (error instanceof Error && error.message === "RATE_LIMITED") return NextResponse.json({ error: "Слишком много обращений по спорам. Попробуйте позже." }, { status: 429 });
    throw error;
  }
  const body = await request.json().catch(() => ({}));
  const matchId = String(body.matchId || "").trim();
  const reason = String(body.reason || "").trim();
  if (!matchId || reason.length < 10) return NextResponse.json({ error: "Match and a meaningful reason are required" }, { status: 400 });
  if (reason.length > 3000) return NextResponse.json({ error: "Reason is too long" }, { status: 400 });

  try {
    const dispute = await prisma.$transaction(async tx => {
      const matches = await tx.$queryRaw<Array<{ id: string; playerOneId: string; playerTwoId: string | null; status: string; economyMode: "REAL" | "DEMO" }>>`
        SELECT id, "playerOneId", "playerTwoId", status, "economyMode" FROM "Match" WHERE id = ${matchId}::uuid FOR UPDATE
      `;
      const match = matches[0];
      if (!match) throw new Error("NOT_FOUND");
      // The eligibility rules live in one shared helper so the match page
      // (GET /api/matches/:id) and this creation path can never disagree.
      const eligibility = await evaluateDisputeEligibility(tx, matchId, me.id);
      if (!eligibility.canOpen) throw new Error(DISPUTE_REASON_TO_ERROR[eligibility.reason]);

      const created = await tx.dispute.create({ data: { matchId, reporterId: me.id, reason, status: "OPEN" } });
      await tx.match.update({ where: { id: matchId }, data: { status: "DISPUTED" } });
      await notifyDisputeUpdate(tx, me.id, { matchId, economyMode: match.economyMode, kind: "DISPUTE_OPENED", role: "REPORTER" });
      const opponentId = match.playerOneId === me.id ? match.playerTwoId : match.playerOneId;
      if (opponentId) await notifyDisputeUpdate(tx, opponentId, { matchId, economyMode: match.economyMode, kind: "DISPUTE_OPENED", role: "OPPONENT" });
      return created;
    });
    await auditRequest(request, me.id, "CREATE_DISPUTE", "DISPUTE", dispute.id, { matchId });
    return NextResponse.json(dispute, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const map: Record<string, [string, number]> = {
      NOT_FOUND: ["Match not found", 404],
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
    try {
      await prisma.$transaction(tx => enforceRateLimit(tx, me.id, "DISPUTE_EVIDENCE", 30, 10 * 60_000));
    } catch (error) {
      if (error instanceof Error && error.message === "RATE_LIMITED") return NextResponse.json({ error: "Слишком много файловых операций. Попробуйте позже." }, { status: 429 });
      throw error;
    }
    const id = String(body.id || "").trim();
    const fileUrl = String(body.fileUrl || "").trim();
    const type = String(body.type || "IMAGE");
    if (!id || !fileUrl || !isEvidenceType(type)) return NextResponse.json({ error: "Invalid evidence" }, { status: 400 });
    // A data URL carries the uploaded file itself; a normal https link is an
    // external reference. Both are bounded, and the mime type of a data URL
    // must match the declared evidence type.
    const validation = validateEvidenceFile(fileUrl, type);
    if (!validation.ok) {
      if (validation.code === "UNSUPPORTED_TYPE") return NextResponse.json({ error: "Unsupported evidence file type" }, { status: 400 });
      if (validation.code === "TOO_LARGE") return NextResponse.json({ error: "Evidence file is too large" }, { status: 413 });
      return NextResponse.json({ error: "Invalid evidence" }, { status: 400 });
    }
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

  let access: Awaited<ReturnType<typeof requirePermission>>;
  try {
    access = await requirePermission("disputes.resolve");
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "ADMIN_LOGIN_REQUIRED") return NextResponse.json({ error: "Unauthorized", errorCode: code }, { status: 401 });
    if (code === "FORBIDDEN" || code.startsWith("ADMIN_MFA_")) return NextResponse.json({ error: "Forbidden", errorCode: code }, { status: 403 });
    throw error;
  }
  try {
    await prisma.$transaction(tx => enforceRateLimit(tx, access.user.id, "DISPUTE_ADMIN_RESOLVE", 30, 10 * 60_000));
  } catch (error) {
    if (error instanceof Error && error.message === "RATE_LIMITED") return NextResponse.json({ error: "Слишком много административных операций со спорами." }, { status: 429 });
    throw error;
  }
  const id = String(body.id || "");
  const decisionValue = String(body.decision || "");
  if (!id || !isDecision(decisionValue)) return NextResponse.json({ error: "Invalid dispute decision" }, { status: 400 });

  try {
    const result = await withDemoPolicyTransaction(async ({ db: tx, demo }) => {
      const disputes = await tx.$queryRaw<DisputeLockRow[]>`
        SELECT id, "matchId", "reporterId", status, "adminDecision" FROM "Dispute" WHERE id = ${id}::uuid FOR UPDATE
      `;
      const d = disputes[0];
      if (!d) throw new Error("NOT_FOUND");
      if (["RESOLVED_BY_ADMIN", "CLOSED"].includes(d.status)) {
        if (d.adminDecision !== decisionValue) throw new Error("DISPUTE_DECISION_CONFLICT");
        return { id: d.id, idempotent: true };
      }

      const matches = await tx.$queryRaw<DisputeMatchRow[]>`SELECT * FROM "Match" WHERE id = ${d.matchId}::uuid FOR UPDATE`;
      const match = matches[0];
      if (!match || match.status !== "DISPUTED") throw new Error("MATCH_STATE");
      const stake = Number(match.betAmount);
      if (!Number.isFinite(stake) || stake <= 0) throw new Error("INVALID_STAKE");
      const p1 = String(match.playerOneId), p2 = String(match.playerTwoId || "");
      if (!p2) throw new Error("INVALID_PLAYERS");

      const winnerId = decisionValue === "WINNER_PLAYER_ONE" ? p1 : decisionValue === "WINNER_PLAYER_TWO" ? p2 : null;
      const loserId = winnerId ? (winnerId === p1 ? p2 : p1) : null;
      if (match.economyMode === "DEMO") {
        const demoStake = new Prisma.Decimal(String(match.betAmount));
        const demoFee = new Prisma.Decimal(String(match.commission));
        await demo.resolveDemoDispute(match.id, id, decisionValue, winnerId, demoStake, demoFee);
        const updatedMatch = await tx.match.update({ where: { id: match.id }, data: { status: winnerId ? "FINISHED" : "CANCELLED", winnerId, loserId, endedAt: new Date(), connectionPhaseCompleted: true } });
        const updatedDispute = await tx.dispute.update({ where: { id }, data: { adminDecision: decisionValue, status: "RESOLVED_BY_ADMIN", adminNotes: String(body.notes || "").slice(0, 2000), resolvedAt: new Date() } });
        for (const userId of [p1, p2]) await notifyDisputeUpdate(tx, userId, { matchId: match.id, economyMode: match.economyMode, kind: "DISPUTE_RESOLVED", decision: decisionValue });
        return { dispute: updatedDispute, match: updatedMatch, idempotent: false };
      }

      const wallets = await tx.wallet.findMany({ where: { userId: { in: [p1, p2] } }, select: { userId: true } });
      if (wallets.length !== 2) throw new Error("WALLET");

      if (winnerId) {
        const payout = Math.max(0, Number((stake * 2 - Number(match.commission)).toFixed(4)));
        const credited = await creditWallet(tx, winnerId, payout, `dispute-win:${id}`, "MATCH_WIN", "Dispute resolution payout", match.id);
        if (!credited.idempotent) {
          await releaseWalletHold(tx, p1, stake, `match-stake-release:dispute:${id}:${p1}`, "MATCH_STAKE", match.id, "CONSUMED", "Dispute resolution payout");
          await releaseWalletHold(tx, p2, stake, `match-stake-release:dispute:${id}:${p2}`, "MATCH_STAKE", match.id, "CONSUMED", "Dispute resolution payout");
          await recordPlatformLedgerEntry(tx, { type: "MATCH_COMMISSION", amount: Number(match.commission), referenceType: "MATCH", referenceId: match.id, description: "Match commission · dispute resolution" });
          await awardXp(tx, winnerId, 100); await awardXp(tx, loserId!, 25);
          await updateMatchProgress(tx, winnerId, true); await updateMatchProgress(tx, loserId!, false);
          await updateRatingAfterDuel(tx, winnerId, loserId!);
          await evaluateAndUnlockAchievements(tx, winnerId, { matchId: match.id, won: true, weapon: match.weaponModifier === 'KNIFE_ONLY' ? 'KNIFE_ONLY' : null });
          await evaluateAndUnlockAchievements(tx, loserId!, { matchId: match.id, won: false, weapon: null });
        }
      } else {
        for (const userId of [p1, p2]) {
          await creditWallet(tx, userId, stake, `dispute-refund:${id}:${userId}`, "REFUND", "Dispute resolution refund", match.id);
          await releaseWalletHold(tx, userId, stake, `match-stake-release:dispute-refund:${id}:${userId}`, "MATCH_STAKE", match.id, "RELEASED", "Dispute resolution refund");
        }
      }

      const updatedMatch = await tx.match.update({ where: { id: match.id }, data: { status: winnerId ? "FINISHED" : "CANCELLED", winnerId, loserId, endedAt: new Date(), connectionPhaseCompleted: true } });
      const updatedDispute = await tx.dispute.update({ where: { id }, data: { adminDecision: decisionValue, status: "RESOLVED_BY_ADMIN", adminNotes: String(body.notes || "").slice(0, 2000), resolvedAt: new Date() } });
      for (const userId of [p1, p2]) await notifyDisputeUpdate(tx, userId, { matchId: match.id, economyMode: match.economyMode, kind: "DISPUTE_RESOLVED", decision: decisionValue });
      return { dispute: updatedDispute, match: updatedMatch, idempotent: false };
    });
    if (!result.idempotent) await auditRequest(request, access.user.id, "RESOLVE_DISPUTE", "DISPUTE", id, { decision: decisionValue });
    return NextResponse.json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const map: Record<string, [string, number]> = { NOT_FOUND: ["Dispute not found", 404], MATCH_STATE: ["Match is not awaiting dispute resolution", 409], LOCKED_STAKE: ["Locked stake is unavailable", 409], INVALID_STAKE: ["Invalid match stake", 409], INVALID_PLAYERS: ["Match has invalid players", 409], WALLET: ["Player wallet not found", 500] };
    if (map[code]) return NextResponse.json({ error: map[code][0] }, { status: map[code][1] });
      if (code === "DISPUTE_DECISION_CONFLICT" || code === "DISPUTE_DECISION_MISMATCH") return NextResponse.json({ error: "Dispute decision conflicts with its current state" }, { status: 409 });
      if (code === "INVALID_MATCH_PLAYERS") return NextResponse.json({ error: "Match participant data is inconsistent" }, { status: 409 });
      if (code.startsWith("DEMO_SETTLEMENT_") || code === "DEMO_DISPUTE_ADJUSTMENT_PARTIAL") return NextResponse.json({ error: "DEMO settlement data is inconsistent; no changes were applied", errorCode: code }, { status: 409 });
    console.error(error); return NextResponse.json({ error: "Failed to resolve dispute" }, { status: 500 });
  }
}
