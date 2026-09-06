-- Prevent multiple simultaneous disputes for the same match at the database boundary.
CREATE UNIQUE INDEX IF NOT EXISTS "Dispute_one_open_per_match_idx"
ON "Dispute" ("matchId")
WHERE "status" IN ('OPEN', 'UNDER_REVIEW', 'AI_PROCESSED');
