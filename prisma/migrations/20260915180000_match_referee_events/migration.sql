CREATE TABLE "MatchRefereeEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "matchId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "steamId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchRefereeEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MatchRefereeEvent_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MatchRefereeEvent_matchId_sequence_key" ON "MatchRefereeEvent"("matchId", "sequence");
CREATE INDEX "MatchRefereeEvent_matchId_createdAt_idx" ON "MatchRefereeEvent"("matchId", "createdAt");
CREATE INDEX "MatchRefereeEvent_matchId_type_idx" ON "MatchRefereeEvent"("matchId", "type");
