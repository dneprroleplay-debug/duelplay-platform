import { Prisma } from "@prisma/client";

/**
 * Single source of truth for "may this player open a dispute for this match?".
 *
 * The match page renders the dispute button from the flag returned by
 * `GET /api/matches/:id`, and `POST /api/disputes` re-validates the very same
 * rules inside the transaction before creating anything. Both sides therefore
 * use identical criteria; the client never decides on its own.
 */
export const DISPUTE_DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

export const DISPUTE_OPEN_STATUSES = ["OPEN", "UNDER_REVIEW", "AI_PROCESSED"] as const;

export type DisputeEligibilityReason =
  | "ELIGIBLE"
  | "NOT_PARTICIPANT"
  | "MATCH_NOT_FINISHED"
  | "MATCH_ALREADY_DISPUTED"
  | "DUPLICATE_DISPUTE";

export type DisputeEligibility = {
  canOpen: boolean;
  reason: DisputeEligibilityReason;
};

type EligibilityClient = Pick<Prisma.TransactionClient, "match" | "dispute">;

export async function evaluateDisputeEligibility(
  tx: EligibilityClient,
  matchId: string,
  userId: string,
): Promise<DisputeEligibility> {
  if (!matchId || !userId) return { canOpen: false, reason: "NOT_PARTICIPANT" };
  const match = await tx.match.findUnique({
    where: { id: matchId },
    select: { id: true, playerOneId: true, playerTwoId: true, status: true },
  });
  if (!match) return { canOpen: false, reason: "MATCH_NOT_FINISHED" };
  if (![match.playerOneId, match.playerTwoId].includes(userId)) {
    return { canOpen: false, reason: "NOT_PARTICIPANT" };
  }
  if (match.status === "DISPUTED") return { canOpen: false, reason: "MATCH_ALREADY_DISPUTED" };
  if (match.status !== "FINISHED") return { canOpen: false, reason: "MATCH_NOT_FINISHED" };
  const open = await tx.dispute.findFirst({
    where: {
      matchId,
      reporterId: userId,
      createdAt: { gte: new Date(Date.now() - DISPUTE_DUPLICATE_WINDOW_MS) },
      status: { in: [...DISPUTE_OPEN_STATUSES] },
    },
    select: { id: true },
  });
  if (open) return { canOpen: false, reason: "DUPLICATE_DISPUTE" };
  return { canOpen: true, reason: "ELIGIBLE" };
}

/** Stable API error codes derived from the shared eligibility rules. */
export const DISPUTE_REASON_TO_ERROR: Record<DisputeEligibilityReason, string> = {
  ELIGIBLE: "OK",
  NOT_PARTICIPANT: "NOT_PARTICIPANT",
  MATCH_NOT_FINISHED: "MATCH_NOT_DISPUTABLE",
  MATCH_ALREADY_DISPUTED: "ALREADY_DISPUTED",
  DUPLICATE_DISPUTE: "DUPLICATE_DISPUTE",
};
