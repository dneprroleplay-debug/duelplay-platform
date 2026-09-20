-- CreateEnum
CREATE TYPE "WalletHoldType" AS ENUM ('MATCH_STAKE', 'WITHDRAWAL');

-- CreateEnum
CREATE TYPE "WalletHoldStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CONSUMED');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('RUNNING', 'COMPLETED', 'WITH_DISCREPANCY', 'FAILED');

-- CreateEnum
CREATE TYPE "PlatformLedgerType" AS ENUM ('MATCH_COMMISSION', 'PAYMENT_FEE', 'WITHDRAWAL_FEE', 'MANUAL_ADJUSTMENT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransactionType" ADD VALUE 'WITHDRAWAL_RESERVE';
ALTER TYPE "TransactionType" ADD VALUE 'WITHDRAWAL_RELEASE';
ALTER TYPE "TransactionType" ADD VALUE 'WITHDRAWAL_COMPLETED';
ALTER TYPE "TransactionType" ADD VALUE 'MATCH_STAKE_LOCK';
ALTER TYPE "TransactionType" ADD VALUE 'MATCH_STAKE_RELEASE';

-- DropIndex
DROP INDEX "WebhookEvent_externalId_key";

-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN     "currency" CHAR(3) NOT NULL DEFAULT 'USD',
ALTER COLUMN "balance" SET DEFAULT 0.0000;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "currency" CHAR(3) NOT NULL DEFAULT 'USD',
ADD COLUMN     "lockedBalanceAfter" DECIMAL(20,4) NOT NULL DEFAULT 0.0000,
ADD COLUMN     "lockedBalanceBefore" DECIMAL(20,4) NOT NULL DEFAULT 0.0000,
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "referenceType" VARCHAR(64);

-- AlterTable
ALTER TABLE "Deposit" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "currency" CHAR(3) NOT NULL DEFAULT 'USD',
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "failureReason" VARCHAR(500),
ADD COLUMN     "providerReference" VARCHAR(255);

-- AlterTable
ALTER TABLE "Withdrawal" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "currency" CHAR(3) NOT NULL DEFAULT 'USD',
ADD COLUMN     "failureReason" VARCHAR(500),
ADD COLUMN     "providerReference" VARCHAR(255),
ADD COLUMN     "providerTxId" TEXT;

-- AlterTable
ALTER TABLE "WebhookEvent" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "errorMessage" VARCHAR(500);

-- Backfill existing nullable webhook IDs before enforcing NOT NULL.
UPDATE "WebhookEvent"
SET "externalId" = 'legacy-' || "id"::text
WHERE "externalId" IS NULL
   OR btrim("externalId") = ''
   OR char_length("externalId") > 255;

-- AlterTable
ALTER TABLE "WebhookEvent"
ALTER COLUMN "externalId" SET DATA TYPE VARCHAR(255),
ALTER COLUMN "externalId" SET NOT NULL;


-- CreateTable
CREATE TABLE "WalletHold" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "walletId" UUID NOT NULL,
    "type" "WalletHoldType" NOT NULL,
    "status" "WalletHoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "amount" DECIMAL(20,4) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "referenceType" VARCHAR(64),
    "referenceId" UUID,
    "idempotencyKey" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "WalletHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycVerification" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "status" "KycStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "provider" VARCHAR(64),
    "providerCaseId" VARCHAR(255),
    "rejectionReason" VARCHAR(500),
    "metadata" JSONB,
    "submittedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentReconciliation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" "PaymentProvider" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'RUNNING',
    "totalDeposits" DECIMAL(20,4) NOT NULL DEFAULT 0.0000,
    "totalWithdrawals" DECIMAL(20,4) NOT NULL DEFAULT 0.0000,
    "mismatchAmount" DECIMAL(20,4) NOT NULL DEFAULT 0.0000,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformLedgerEntry" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" "PlatformLedgerType" NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "amount" DECIMAL(20,4) NOT NULL,
    "referenceType" VARCHAR(64),
    "referenceId" UUID,
    "externalReference" VARCHAR(255),
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WalletHold_idempotencyKey_key" ON "WalletHold"("idempotencyKey");

-- CreateIndex
CREATE INDEX "WalletHold_walletId_status_idx" ON "WalletHold"("walletId", "status");

-- CreateIndex
CREATE INDEX "WalletHold_type_status_idx" ON "WalletHold"("type", "status");

-- CreateIndex
CREATE INDEX "WalletHold_referenceType_referenceId_idx" ON "WalletHold"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "WalletHold_createdAt_idx" ON "WalletHold"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "KycVerification_userId_key" ON "KycVerification"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "KycVerification_providerCaseId_key" ON "KycVerification"("providerCaseId");

-- CreateIndex
CREATE INDEX "KycVerification_status_updatedAt_idx" ON "KycVerification"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "PaymentReconciliation_provider_createdAt_idx" ON "PaymentReconciliation"("provider", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentReconciliation_provider_periodStart_periodEnd_idx" ON "PaymentReconciliation"("provider", "periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentReconciliation_provider_periodStart_periodEnd_key" ON "PaymentReconciliation"("provider", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "PlatformLedgerEntry_type_createdAt_idx" ON "PlatformLedgerEntry"("type", "createdAt");

-- CreateIndex
CREATE INDEX "PlatformLedgerEntry_referenceType_referenceId_idx" ON "PlatformLedgerEntry"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "PlatformLedgerEntry_currency_createdAt_idx" ON "PlatformLedgerEntry"("currency", "createdAt");

-- CreateIndex
CREATE INDEX "Wallet_currency_idx" ON "Wallet"("currency");

-- CreateIndex
CREATE INDEX "Transaction_referenceType_referenceId_idx" ON "Transaction"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "Deposit_provider_providerReference_idx" ON "Deposit"("provider", "providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "Withdrawal_providerTxId_key" ON "Withdrawal"("providerTxId");

-- CreateIndex
CREATE INDEX "Withdrawal_provider_providerReference_idx" ON "Withdrawal"("provider", "providerReference");

-- CreateIndex
CREATE INDEX "WebhookEvent_provider_status_createdAt_idx" ON "WebhookEvent"("provider", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_externalId_key" ON "WebhookEvent"("provider", "externalId");

-- AddForeignKey
ALTER TABLE "WalletHold" ADD CONSTRAINT "WalletHold_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycVerification" ADD CONSTRAINT "KycVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
