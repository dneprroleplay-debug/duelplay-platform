ALTER TABLE "UserLoginReward" ADD COLUMN "cycle" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "UserLoginReward" ADD COLUMN "claimDate" VARCHAR(10);
UPDATE "UserLoginReward" SET "claimDate" = TO_CHAR("claimedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') WHERE "claimDate" IS NULL;
ALTER TABLE "UserLoginReward" ALTER COLUMN "claimDate" SET NOT NULL;
DROP INDEX IF EXISTS "UserLoginReward_userId_day_key";
CREATE UNIQUE INDEX "UserLoginReward_userId_cycle_day_key" ON "UserLoginReward"("userId", "cycle", "day");
CREATE UNIQUE INDEX "UserLoginReward_userId_claimDate_key" ON "UserLoginReward"("userId", "claimDate");
CREATE INDEX "UserLoginReward_userId_claimedAt_idx" ON "UserLoginReward"("userId", "claimedAt");
