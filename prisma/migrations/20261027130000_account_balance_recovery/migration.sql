ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'ACCOUNT_DELETION_RECOVERY_HOLD';
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'ACCOUNT_DELETION_RECOVERY_CREDIT';

CREATE TABLE "AccountRecovery" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "oldUserId" UUID NOT NULL,
    "emailHmac" CHAR(64) NOT NULL,
    "steamHmac" CHAR(64) NOT NULL,
    "realBalance" DECIMAL(20,4) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "status" VARCHAR(24) NOT NULL DEFAULT 'AVAILABLE',
    "sourceLastTransactionId" UUID NOT NULL,
    "recoveryHoldTransactionId" UUID NOT NULL,
    "restoreTransactionId" UUID,
    "restoredUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "restoredAt" TIMESTAMP(3),
    CONSTRAINT "AccountRecovery_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AccountRecovery_oldUserId_key" UNIQUE ("oldUserId"),
    CONSTRAINT "AccountRecovery_recoveryHoldTransactionId_key" UNIQUE ("recoveryHoldTransactionId"),
    CONSTRAINT "AccountRecovery_restoreTransactionId_key" UNIQUE ("restoreTransactionId"),
    CONSTRAINT "AccountRecovery_realBalance_positive" CHECK ("realBalance" > 0),
    CONSTRAINT "AccountRecovery_status_check" CHECK ("status" IN ('AVAILABLE','RESTORED','CONFLICT','BLOCKED'))
);
CREATE INDEX "AccountRecovery_emailHmac_status_idx" ON "AccountRecovery"("emailHmac", "status");
CREATE INDEX "AccountRecovery_emailHmac_steamHmac_status_idx" ON "AccountRecovery"("emailHmac", "steamHmac", "status");
CREATE INDEX "AccountRecovery_status_createdAt_idx" ON "AccountRecovery"("status", "createdAt");
