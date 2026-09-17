CREATE TABLE "ReferralRaceSettlement" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "month" VARCHAR(7) NOT NULL,
  "snapshot" JSONB NOT NULL,
  "settledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "settledById" UUID NOT NULL,
  CONSTRAINT "ReferralRaceSettlement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReferralRaceSettlement_month_key" ON "ReferralRaceSettlement"("month");
CREATE INDEX "ReferralRaceSettlement_settledById_idx" ON "ReferralRaceSettlement"("settledById");
ALTER TABLE "ReferralRaceSettlement" ADD CONSTRAINT "ReferralRaceSettlement_settledById_fkey" FOREIGN KEY ("settledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
