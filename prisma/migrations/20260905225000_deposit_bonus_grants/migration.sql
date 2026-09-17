CREATE TABLE "DepositBonusGrant" (
  "id" TEXT NOT NULL,
  "userId" UUID NOT NULL,
  "depositId" UUID NOT NULL,
  "promotionId" UUID NOT NULL,
  "amount" DECIMAL(20,4) NOT NULL,
  "wagering" DECIMAL(20,4) NOT NULL DEFAULT 0,
  "withdrawable" BOOLEAN NOT NULL DEFAULT false,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DepositBonusGrant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DepositBonusGrant_depositId_key" UNIQUE ("depositId")
);
CREATE INDEX "DepositBonusGrant_userId_expiresAt_idx" ON "DepositBonusGrant"("userId", "expiresAt");
CREATE INDEX "DepositBonusGrant_promotionId_idx" ON "DepositBonusGrant"("promotionId");
