CREATE TABLE IF NOT EXISTS "DuelPass" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "seasonId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "maxLevel" INTEGER NOT NULL DEFAULT 50,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "premiumPrice" DECIMAL(20,4) NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT false,
  "rewards" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DuelPass_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DuelPass_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "DuelPassProgress" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "passId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "level" INTEGER NOT NULL DEFAULT 1,
  "xp" INTEGER NOT NULL DEFAULT 0,
  "premium" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DuelPassProgress_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DuelPassProgress_passId_fkey" FOREIGN KEY ("passId") REFERENCES "DuelPass"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DuelPassProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "DuelPassProgress_passId_userId_key" ON "DuelPassProgress"("passId","userId");
CREATE TABLE IF NOT EXISTS "DuelPassClaim" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "passId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "level" INTEGER NOT NULL,
  "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DuelPassClaim_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DuelPassClaim_passId_fkey" FOREIGN KEY ("passId") REFERENCES "DuelPass"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DuelPassClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "DuelPassClaim_passId_userId_level_key" ON "DuelPassClaim"("passId","userId","level");
CREATE INDEX IF NOT EXISTS "DuelPassClaim_userId_claimedAt_idx" ON "DuelPassClaim"("userId","claimedAt");
CREATE INDEX IF NOT EXISTS "DuelPass_active_startsAt_endsAt_idx" ON "DuelPass"("active","startsAt","endsAt");
