import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { auditRequest } from "@/lib/admin";
import { hasPermission, requirePermission, resolveAdminAccess } from "@/lib/admin-rbac";
import { creditWallet, debitWallet, releaseWalletHold } from "@/lib/wallet";
import { recordPlatformLedgerEntry } from "@/lib/finance";
import { awardXp, updateMatchProgress, updateRatingAfterDuel } from "@/lib/progression";
import { evaluateAndUnlockAchievements } from "@/lib/achievements";
import { enforceRateLimit } from "@/lib/rate-limit";
import { withDemoPolicyTransaction } from "@/lib/demo-policy";
import { notify } from "@/lib/notifications";
import { DISPUTE_REASON_TO_ERROR, evaluateDisputeEligibility } from "@/lib/dispute-eligibility";
import { Prisma } from "@prisma/client";
import { getAuditContext } from "@/lib/request-meta";
import { classifySettlementEvidence } from "@/lib/dispute-settlement-policy";

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
  winnerId: string | null;
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

  const resolutionContext: { disputeId: string; matchId: string | null; economyMode: string | null; decision: string; stage: string } = {
    disputeId: id,
    matchId: null,
    economyMode: null,
    decision: decisionValue,
    stage: "begin",
  };
  const auditContext = getAuditContext(request);
  try {
    const result = await withDemoPolicyTransaction(async ({ db: tx, demo }) => {
      resolutionContext.stage = "lock-dispute";
      const disputes = await tx.$queryRaw<DisputeLockRow[]>`
        SELECT id, "matchId", "reporterId", status, "adminDecision" FROM "Dispute" WHERE id = ${id}::uuid FOR UPDATE
      `;
      const d = disputes[0];
      if (!d) throw new Error("NOT_FOUND");
      resolutionContext.disputeId = d.id;
      resolutionContext.matchId = d.matchId;
      if (["RESOLVED_BY_ADMIN", "CLOSED"].includes(d.status)) {
        if (d.adminDecision !== decisionValue) throw new Error("DISPUTE_DECISION_CONFLICT");
        return { id: d.id, idempotent: true };
      }

      resolutionContext.stage = "lock-match";
      const matches = await tx.$queryRaw<DisputeMatchRow[]>`SELECT * FROM "Match" WHERE id = ${d.matchId}::uuid FOR UPDATE`;
      const match = matches[0];
      if (!match || match.status !== "DISPUTED") throw new Error("MATCH_STATE");
      resolutionContext.matchId = match.id;
      resolutionContext.economyMode = match.economyMode;
      const stake = Number(match.betAmount);
      if (!Number.isFinite(stake) || stake <= 0) throw new Error("INVALID_STAKE");
      const p1 = String(match.playerOneId), p2 = String(match.playerTwoId || "");
      if (!p2) throw new Error("INVALID_PLAYERS");

      const winnerId = decisionValue === "WINNER_PLAYER_ONE" ? p1 : decisionValue === "WINNER_PLAYER_TWO" ? p2 : null;
      const loserId = winnerId ? (winnerId === p1 ? p2 : p1) : null;
      const stakeDecimal = new Prisma.Decimal(String(match.betAmount)).toDecimalPlaces(4);
      const feeDecimal = new Prisma.Decimal(String(match.commission)).toDecimalPlaces(4);
      const payoutDecimal = Prisma.Decimal.max(new Prisma.Decimal(0), stakeDecimal.mul(2).minus(feeDecimal)).toDecimalPlaces(4);

      // Serialize all disputes for a match to one financial outcome. A prior resolved dispute
      // cannot be used to trigger a second settlement under a different decision.
      resolutionContext.stage = "check-other-disputes";
      const otherResolved = await tx.dispute.findMany({
        where: { matchId: match.id, id: { not: id }, status: { in: ["RESOLVED_BY_ADMIN", "CLOSED"] } },
        select: { id: true, adminDecision: true },
      });
      const samePriorDecision = otherResolved.length > 0 && otherResolved.every(row => row.adminDecision === decisionValue);
      if (otherResolved.length && (!samePriorDecision || match.winnerId !== winnerId)) throw new Error("MATCH_DISPUTE_DECISION_CONFLICT");

      // A historical dispute already committed this exact outcome. The match row and
      // previous successful audit are the durable decision record; never run a second
      // settlement even if the original payout has an appended compensation row.
      if (!samePriorDecision) {
      let alreadySettled = false;
      if (match.economyMode === "DEMO") {
        resolutionContext.stage = "inspect-demo-settlement";
        const demoHolds = await tx.demoWalletHold.findMany({
          where: { matchId: match.id }, include: { wallet: { select: { userId: true } } },
        });
        const demoRows = await tx.demoTransaction.findMany({ where: { matchId: match.id } });
        const hasWin = demoRows.some(row => row.type === "MATCH_WIN");
        const hasFee = demoRows.some(row => row.type === "MATCH_FEE");
        const hasClose = demoRows.some(row => row.type === "MATCH_STAKE_RELEASE" || row.type === "MATCH_REFUND");
        const classification = classifySettlementEvidence({
          holds: demoHolds.map(hold => ({ userId: hold.wallet.userId, amount: hold.amount.toString(), status: hold.status })),
          expectedUsers: [p1, p2], stake: stakeDecimal.toString(), hasWinnerPayout: hasWin, hasCommission: hasFee, hasStakeRelease: hasClose,
        });
        if (classification === "INCONSISTENT") throw new Error("DEMO_SETTLEMENT_REQUIRES_MANUAL_REVIEW");
        alreadySettled = classification === "SETTLED";
        if (alreadySettled) {
          resolutionContext.stage = "demo-settlement-adjustment";
          await demo.resolveDemoDispute(match.id, id, decisionValue, winnerId, stakeDecimal, feeDecimal);
        } else {
          resolutionContext.stage = "demo-first-settlement";
          for (const userId of [p1, p2].sort()) {
            await demo.closeDemoWalletHold(userId, match.id, stakeDecimal, `demo:dispute:${id}:initial-hold:${userId}`, winnerId ? "CONSUMED" : "RELEASED");
          }
          if (winnerId) {
            await demo.creditDemoCredits(winnerId, payoutDecimal, `demo:dispute:${id}:initial-award:${winnerId}`, "MATCH_WIN", match.id, "DEMO dispute first settlement");
            if (feeDecimal.gt(0)) await demo.recordDemoMatchFee(match.id, feeDecimal, `demo:dispute:${id}:initial-fee`);
          }
        }
      } else {
        resolutionContext.stage = "inspect-real-settlement";
        const [realTransactions, holds, commissions] = await Promise.all([
          tx.transaction.findMany({
            where: { referenceId: match.id, status: "COMPLETED" },
            include: { wallet: { select: { userId: true } } },
          }),
          tx.walletHold.findMany({
            where: { referenceId: match.id, type: "MATCH_STAKE" },
            include: { wallet: { select: { userId: true, balance: true, lockedBalance: true } } },
          }),
          tx.platformLedgerEntry.findMany({ where: { type: "MATCH_COMMISSION", referenceType: "MATCH", referenceId: match.id } }),
        ]);
        const winRows = realTransactions.filter(row => row.type === "MATCH_WIN" && row.amount.gt(0) && [p1, p2].includes(row.wallet.userId));
        const releaseRows = realTransactions.filter(row => row.type === "MATCH_STAKE_RELEASE");
        const referralRows = realTransactions.filter(row => row.type === "REFERRAL" && row.amount.gt(0));
        const classification = classifySettlementEvidence({
          holds: holds.map(hold => ({ userId: hold.wallet.userId, amount: hold.amount.toString(), status: hold.status })),
          expectedUsers: [p1, p2], stake: stakeDecimal.toString(), hasWinnerPayout: winRows.length > 0,
          hasCommission: commissions.length > 0, hasStakeRelease: releaseRows.length > 0,
        });
        if (classification === "INCONSISTENT") throw new Error("REAL_SETTLEMENT_REQUIRES_MANUAL_REVIEW");
        alreadySettled = classification === "SETTLED";

        if (!alreadySettled) {
          // First settlement: prove both holds exist and are active before calling releaseWalletHold.
          // This prevents the legacy-hold fallback from concealing a missing/closed real hold.
          if (holds.length !== 2 || holds.some(hold => hold.status !== "ACTIVE" || !hold.amount.eq(stakeDecimal)) ||
              holds.some(hold => ![p1, p2].includes(hold.wallet.userId)) || winRows.length || commissions.length || releaseRows.length) {
            throw new Error("REAL_SETTLEMENT_REQUIRES_MANUAL_REVIEW");
          }
          const wallets = await tx.wallet.findMany({ where: { userId: { in: [p1, p2] } }, select: { userId: true } });
          if (wallets.length !== 2) throw new Error("WALLET");
          if (winnerId) {
            resolutionContext.stage = "real-first-winner-payout";
            const credited = await creditWallet(tx, winnerId, payoutDecimal, `dispute-win:${id}`, "MATCH_WIN", "Dispute resolution payout", match.id);
            if (credited.idempotent) throw new Error("REAL_SETTLEMENT_IDEMPOTENCY_CONFLICT");
            for (const userId of [p1, p2].sort()) {
              resolutionContext.stage = userId === p1 ? "real-first-release-player-one" : "real-first-release-player-two";
              await releaseWalletHold(tx, userId, stakeDecimal, `match-stake-release:dispute:${id}:${userId}`, "MATCH_STAKE", match.id, "CONSUMED", "Dispute resolution payout");
            }
            resolutionContext.stage = "real-first-record-commission";
            if (feeDecimal.gt(0)) await recordPlatformLedgerEntry(tx, { type: "MATCH_COMMISSION", amount: feeDecimal, referenceType: "MATCH", referenceId: match.id, description: "Match commission · dispute resolution", metadata: { disputeId: id, settlement: "first" } });
            await awardXp(tx, winnerId, 100); await awardXp(tx, loserId!, 25);
            await updateMatchProgress(tx, winnerId, true); await updateMatchProgress(tx, loserId!, false);
            await updateRatingAfterDuel(tx, winnerId, loserId!);
            await evaluateAndUnlockAchievements(tx, winnerId, { matchId: match.id, won: true, weapon: match.weaponModifier === "KNIFE_ONLY" ? "KNIFE_ONLY" : null });
            await evaluateAndUnlockAchievements(tx, loserId!, { matchId: match.id, won: false, weapon: null });
          } else {
            resolutionContext.stage = "real-first-refund-stakes";
            for (const userId of [p1, p2].sort()) {
              await creditWallet(tx, userId, stakeDecimal, `dispute-refund:${id}:${userId}`, "REFUND", "Dispute resolution refund", match.id);
              await releaseWalletHold(tx, userId, stakeDecimal, `match-stake-release:dispute-refund:${id}:${userId}`, "MATCH_STAKE", match.id, "RELEASED", "Dispute resolution refund");
            }
          }
        } else {
          // A completed MATCH_WIN plus consumed holds and the fee ledger is the source of truth.
          // Match.status alone never authorizes a second payout.
          if (winRows.length !== 1) throw new Error("REAL_SETTLEMENT_LEDGER_INCONSISTENT");
          const originalWin = winRows[0];
          const originalWinnerId = originalWin.wallet.userId;
          const expectedPayout = payoutDecimal;
          if (!originalWin.amount.eq(expectedPayout) || ![p1, p2].includes(originalWinnerId) ||
              holds.length !== 2 || holds.some(hold => hold.status !== "CONSUMED" || !hold.amount.eq(stakeDecimal)) ||
              releaseRows.length !== 2 || commissions.length !== (feeDecimal.gt(0) ? 1 : 0) ||
              (feeDecimal.gt(0) && !commissions[0].amount.eq(feeDecimal)) ||
              realTransactions.filter(row => row.type === "MATCH_WIN" && row.amount.gt(0)).length !== 1) {
            throw new Error("REAL_SETTLEMENT_LEDGER_INCONSISTENT");
          }
          if (match.winnerId && match.winnerId !== originalWinnerId) throw new Error("REAL_SETTLEMENT_REQUIRES_MANUAL_REVIEW");
          if (winnerId === originalWinnerId) {
            // The requested decision agrees with the actual completed payout. No wallet, hold,
            // commission, progression or rating operation is repeated.
          } else {
            // The existing wallet API has no debt/negative-balance facility. Only compensate when
            // the full prior payout is still available and no referral payout also needs reversal.
            if (referralRows.length) throw new Error("REAL_SETTLEMENT_REQUIRES_MANUAL_REVIEW");
            const previousAdjustment = await tx.transaction.findFirst({ where: { referenceId: match.id, type: "DISPUTE_ADJUSTMENT", status: "COMPLETED" } });
            if (previousAdjustment) throw new Error("REAL_SETTLEMENT_REQUIRES_MANUAL_REVIEW");
            const originalWallet = await tx.wallet.findUnique({ where: { userId: originalWinnerId }, select: { balance: true } });
            if (!originalWallet || originalWallet.balance.lt(originalWin.amount)) throw new Error("DISPUTE_COMPENSATION_INSUFFICIENT_BALANCE");
            resolutionContext.stage = "real-compensate-original-payout";
            await debitWallet(tx, originalWinnerId, originalWin.amount, `dispute:${id}:reverse-payout:${originalWinnerId}`, "DISPUTE_ADJUSTMENT", "Reverse prior REAL match payout after dispute", match.id);
            if (winnerId) {
              resolutionContext.stage = "real-compensate-replacement-payout";
              await creditWallet(tx, winnerId, payoutDecimal, `dispute:${id}:replacement-payout:${winnerId}`, "MATCH_WIN", "Replacement payout after dispute resolution", match.id);
            } else {
              resolutionContext.stage = "real-compensate-refund-player-one";
              await creditWallet(tx, p1, stakeDecimal, `dispute:${id}:refund:${p1}`, "REFUND", "Stake refund after dispute reversal", match.id);
              resolutionContext.stage = "real-compensate-refund-player-two";
              await creditWallet(tx, p2, stakeDecimal, `dispute:${id}:refund:${p2}`, "REFUND", "Stake refund after dispute reversal", match.id);
              if (feeDecimal.gt(0)) {
                resolutionContext.stage = "real-compensate-commission";
                await recordPlatformLedgerEntry(tx, { type: "MANUAL_ADJUSTMENT", amount: feeDecimal.negated(), referenceType: "MATCH", referenceId: match.id, description: "Reverse match commission after dispute refund", metadata: { disputeId: id, originalCommissionId: commissions[0].id, reason: "DISPUTE_CANCELLED_SETTLED_MATCH" } });
              }
            }
          }
        }
      }
      }

      resolutionContext.stage = "update-match-and-dispute";
      const updatedMatch = await tx.match.update({ where: { id: match.id }, data: { status: winnerId ? "FINISHED" : "CANCELLED", winnerId, loserId, endedAt: new Date(), connectionPhaseCompleted: true } });
      const updatedDispute = await tx.dispute.update({ where: { id }, data: { adminDecision: decisionValue, status: "RESOLVED_BY_ADMIN", adminNotes: String(body.notes || "").slice(0, 2000), resolvedAt: new Date() } });
      for (const userId of [p1, p2]) await notifyDisputeUpdate(tx, userId, { matchId: match.id, economyMode: match.economyMode, kind: "DISPUTE_RESOLVED", decision: decisionValue });
      resolutionContext.stage = "write-audit";
      await tx.auditLog.create({ data: { userId: access.user.id, action: "RESOLVE_DISPUTE", targetType: "DISPUTE", targetId: id, ipAddress: auditContext.ipAddress || "application", userAgent: auditContext.userAgent || "DuelPlay admin", requestId: auditContext.requestId || null, result: "SUCCESS", reason: null, payload: { decision: decisionValue } as Prisma.InputJsonValue } });
      return { dispute: updatedDispute, match: updatedMatch, idempotent: false };
    });
    return NextResponse.json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const errorRecord = error && typeof error === "object" ? error as { code?: unknown; name?: unknown } : null;
    console.error("[disputes] resolution failed", {
      disputeId: resolutionContext.disputeId,
      matchId: resolutionContext.matchId,
      economyMode: resolutionContext.economyMode,
      decision: resolutionContext.decision,
      stage: resolutionContext.stage,
      errorCode: /^[A-Z0-9_]{1,80}$/.test(code) ? code : "UNEXPECTED_ERROR",
      prismaCode: typeof errorRecord?.code === "string" ? errorRecord.code : null,
      errorName: typeof errorRecord?.name === "string" ? errorRecord.name : null,
    });
    if (["DISPUTE_COMPENSATION_INSUFFICIENT_BALANCE", "INSUFFICIENT_BALANCE", "REAL_SETTLEMENT_REQUIRES_MANUAL_REVIEW", "REAL_SETTLEMENT_LEDGER_INCONSISTENT", "DEMO_SETTLEMENT_REQUIRES_MANUAL_REVIEW", "REAL_SETTLEMENT_IDEMPOTENCY_CONFLICT", "MATCH_DISPUTE_DECISION_CONFLICT"].includes(code)) {
      try {
        await auditRequest(request, access.user.id, "RESOLVE_DISPUTE_BLOCKED", "DISPUTE", resolutionContext.disputeId, {
          matchId: resolutionContext.matchId, decision: resolutionContext.decision, stage: resolutionContext.stage,
        }, "BLOCKED", code);
      } catch (auditError) {
        console.error("[disputes] failed to persist blocked-resolution audit", {
          disputeId: resolutionContext.disputeId, matchId: resolutionContext.matchId,
          errorCode: auditError instanceof Error && /^[A-Z0-9_]{1,80}$/.test(auditError.message) ? auditError.message : "AUDIT_WRITE_FAILED",
        });
      }
    }
    const map: Record<string, [string, number]> = {
      NOT_FOUND: ["Dispute not found", 404], MATCH_STATE: ["Match is not awaiting dispute resolution", 409],
      LOCKED_STAKE: ["Locked stake is unavailable", 409], INVALID_STAKE: ["Invalid match stake", 409],
      INVALID_PLAYERS: ["Match has invalid players", 409], WALLET: ["Player wallet not found", 500],
      DISPUTE_COMPENSATION_INSUFFICIENT_BALANCE: ["Previous payout is no longer fully available. This dispute requires manual financial review; no changes were applied.", 409],
      INSUFFICIENT_BALANCE: ["Previous payout is no longer fully available. This dispute requires manual financial review; no changes were applied.", 409],
      REAL_SETTLEMENT_REQUIRES_MANUAL_REVIEW: ["Existing REAL settlement cannot be safely reconciled automatically. Manual financial review is required.", 409],
      REAL_SETTLEMENT_LEDGER_INCONSISTENT: ["REAL settlement ledger is inconsistent. No changes were applied; manual review is required.", 409],
      DEMO_SETTLEMENT_REQUIRES_MANUAL_REVIEW: ["DEMO settlement records are inconsistent. No changes were applied; manual review is required.", 409],
      REAL_SETTLEMENT_IDEMPOTENCY_CONFLICT: ["A conflicting REAL settlement transaction already exists. Manual review is required.", 409],
      MATCH_DISPUTE_DECISION_CONFLICT: ["Another dispute for this match was already resolved with a conflicting decision.", 409],
    };
    if (map[code]) return NextResponse.json({ error: map[code][0] }, { status: map[code][1] });
      if (code === "DISPUTE_DECISION_CONFLICT" || code === "DISPUTE_DECISION_MISMATCH") return NextResponse.json({ error: "Dispute decision conflicts with its current state" }, { status: 409 });
      if (code === "INVALID_MATCH_PLAYERS") return NextResponse.json({ error: "Match participant data is inconsistent" }, { status: 409 });
      if (code.startsWith("DEMO_SETTLEMENT_") || code === "DEMO_DISPUTE_ADJUSTMENT_PARTIAL") return NextResponse.json({ error: "DEMO settlement data is inconsistent; no changes were applied", errorCode: code }, { status: 409 });
    return NextResponse.json({ error: "Failed to resolve dispute" }, { status: 500 });
  }
}
