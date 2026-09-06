-- DuelPlay v30: match lifecycle deadlines and connection phase state.
-- IF NOT EXISTS keeps this migration safe when one or more columns were
-- already added manually in a local/test database.
ALTER TABLE "Match" ADD COLUMN IF NOT EXISTS "startDeadlineAt" TIMESTAMP(3);
ALTER TABLE "Match" ADD COLUMN IF NOT EXISTS "connectionDeadlineAt" TIMESTAMP(3);
ALTER TABLE "Match" ADD COLUMN IF NOT EXISTS "connectionPhaseCompleted" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "Match_startDeadlineAt_idx" ON "Match"("startDeadlineAt");
CREATE INDEX IF NOT EXISTS "Match_connectionDeadlineAt_idx" ON "Match"("connectionDeadlineAt");
