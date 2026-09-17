ALTER TABLE "Match" ADD COLUMN IF NOT EXISTS "liveDeadlineAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Match_liveDeadlineAt_idx" ON "Match"("liveDeadlineAt");
