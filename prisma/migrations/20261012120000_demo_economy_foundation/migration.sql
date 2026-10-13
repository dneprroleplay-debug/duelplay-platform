-- Add an isolated virtual-credit ledger. Existing matches become REAL through
-- the NOT NULL default; no REAL financial tables are modified.

CREATE TYPE "MatchEconomyMode" AS ENUM ('REAL', 'DEMO');
CREATE TYPE "DemoTransactionType" AS ENUM (
    'STARTER_GRANT',
    'MATCH_STAKE',
    'MATCH_STAKE_LOCK',
    'MATCH_STAKE_RELEASE',
    'MATCH_REFUND',
    'MATCH_WIN',
    'MATCH_FEE',
    'BALANCE_ADJUSTMENT'
);
CREATE TYPE "DemoWalletHoldStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CONSUMED');

ALTER TABLE "Match"
    ADD COLUMN "economyMode" "MatchEconomyMode" NOT NULL DEFAULT 'REAL';

CREATE INDEX "Match_economyMode_status_createdAt_idx"
    ON "Match"("economyMode", "status", "createdAt");

CREATE FUNCTION "prevent_match_economy_mode_change"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."economyMode" IS DISTINCT FROM OLD."economyMode" THEN
        RAISE EXCEPTION 'Match economyMode is immutable'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "Match_economyMode_immutable"
    BEFORE UPDATE OF "economyMode" ON "Match"
    FOR EACH ROW
    EXECUTE FUNCTION "prevent_match_economy_mode_change"();

CREATE TABLE "DemoWallet" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "balance" DECIMAL(20,4) NOT NULL DEFAULT 0.0000,
    "lockedBalance" DECIMAL(20,4) NOT NULL DEFAULT 0.0000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DemoWallet_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DemoWallet_balance_nonnegative" CHECK ("balance" >= 0),
    CONSTRAINT "DemoWallet_lockedBalance_nonnegative" CHECK ("lockedBalance" >= 0)
);

CREATE UNIQUE INDEX "DemoWallet_userId_key" ON "DemoWallet"("userId");
CREATE UNIQUE INDEX "DemoWallet_id_userId_key" ON "DemoWallet"("id", "userId");
CREATE INDEX "DemoWallet_createdAt_idx" ON "DemoWallet"("createdAt");

ALTER TABLE "DemoWallet"
    ADD CONSTRAINT "DemoWallet_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DemoTransaction" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "walletId" UUID,
    "userId" UUID,
    "matchId" UUID,
    "type" "DemoTransactionType" NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "balanceBefore" DECIMAL(20,4),
    "balanceAfter" DECIMAL(20,4),
    "idempotencyKey" TEXT NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DemoTransaction_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DemoTransaction_idempotencyKey_nonempty" CHECK (length(regexp_replace("idempotencyKey", '[[:space:]]', '', 'g')) > 0),
    CONSTRAINT "DemoTransaction_wallet_context_check" CHECK (
        ("type" = 'MATCH_FEE' AND "walletId" IS NULL AND "userId" IS NULL
            AND "balanceBefore" IS NULL AND "balanceAfter" IS NULL AND "matchId" IS NOT NULL)
        OR
        ("type" <> 'MATCH_FEE' AND "walletId" IS NOT NULL AND "userId" IS NOT NULL
            AND "balanceBefore" IS NOT NULL AND "balanceAfter" IS NOT NULL)
    ),
    CONSTRAINT "DemoTransaction_match_context_check" CHECK (
        "type" NOT IN ('MATCH_STAKE', 'MATCH_STAKE_LOCK', 'MATCH_STAKE_RELEASE', 'MATCH_REFUND', 'MATCH_WIN', 'MATCH_FEE')
        OR "matchId" IS NOT NULL
    ),
    CONSTRAINT "DemoTransaction_amount_semantics_check" CHECK (
        ("type" = 'MATCH_STAKE' AND "amount" < 0)
        OR ("type" IN ('MATCH_STAKE_LOCK', 'MATCH_STAKE_RELEASE') AND "amount" = 0)
        OR ("type" IN ('STARTER_GRANT', 'MATCH_REFUND', 'MATCH_WIN', 'MATCH_FEE') AND "amount" > 0)
        OR ("type" = 'BALANCE_ADJUSTMENT' AND "amount" <> 0)
    )
);

CREATE UNIQUE INDEX "DemoTransaction_idempotencyKey_key"
    ON "DemoTransaction"("idempotencyKey");
CREATE UNIQUE INDEX "DemoTransaction_one_starter_grant_per_user_key"
    ON "DemoTransaction"("userId", "type") WHERE "type" = 'STARTER_GRANT';
CREATE INDEX "DemoTransaction_walletId_createdAt_idx"
    ON "DemoTransaction"("walletId", "createdAt");
CREATE INDEX "DemoTransaction_userId_createdAt_idx"
    ON "DemoTransaction"("userId", "createdAt");
CREATE INDEX "DemoTransaction_matchId_type_idx"
    ON "DemoTransaction"("matchId", "type");
CREATE INDEX "DemoTransaction_type_createdAt_idx"
    ON "DemoTransaction"("type", "createdAt");

ALTER TABLE "DemoTransaction"
    ADD CONSTRAINT "DemoTransaction_walletId_userId_fkey"
    FOREIGN KEY ("walletId", "userId") REFERENCES "DemoWallet"("id", "userId")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DemoTransaction"
    ADD CONSTRAINT "DemoTransaction_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DemoTransaction"
    ADD CONSTRAINT "DemoTransaction_matchId_fkey"
    FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "prevent_demo_transaction_mutation"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'DemoTransaction history is append-only'
        USING ERRCODE = 'check_violation';
    RETURN OLD;
END;
$$;

CREATE TRIGGER "DemoTransaction_append_only"
    BEFORE UPDATE OR DELETE ON "DemoTransaction"
    FOR EACH ROW
    EXECUTE FUNCTION "prevent_demo_transaction_mutation"();

CREATE TABLE "DemoWalletHold" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "walletId" UUID NOT NULL,
    "matchId" UUID NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "status" "DemoWalletHoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    CONSTRAINT "DemoWalletHold_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DemoWalletHold_amount_positive" CHECK ("amount" > 0),
    CONSTRAINT "DemoWalletHold_idempotencyKey_nonempty" CHECK (length(regexp_replace("idempotencyKey", '[[:space:]]', '', 'g')) > 0),
    CONSTRAINT "DemoWalletHold_closedAt_status_check" CHECK (
        ("status" = 'ACTIVE' AND "closedAt" IS NULL)
        OR ("status" IN ('RELEASED', 'CONSUMED') AND "closedAt" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "DemoWalletHold_idempotencyKey_key"
    ON "DemoWalletHold"("idempotencyKey");
CREATE UNIQUE INDEX "DemoWalletHold_walletId_matchId_key"
    ON "DemoWalletHold"("walletId", "matchId");
CREATE INDEX "DemoWalletHold_walletId_status_idx"
    ON "DemoWalletHold"("walletId", "status");
CREATE INDEX "DemoWalletHold_matchId_status_idx"
    ON "DemoWalletHold"("matchId", "status");
CREATE INDEX "DemoWalletHold_createdAt_idx"
    ON "DemoWalletHold"("createdAt");

ALTER TABLE "DemoWalletHold"
    ADD CONSTRAINT "DemoWalletHold_walletId_fkey"
    FOREIGN KEY ("walletId") REFERENCES "DemoWallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DemoWalletHold"
    ADD CONSTRAINT "DemoWalletHold_matchId_fkey"
    FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "require_demo_match_for_virtual_finance"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    match_economy "MatchEconomyMode";
BEGIN
    IF NEW."matchId" IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT "economyMode" INTO match_economy
        FROM "Match" WHERE "id" = NEW."matchId";
    IF match_economy IS DISTINCT FROM 'DEMO' THEN
        RAISE EXCEPTION 'DEMO finance may only reference DEMO matches'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "DemoTransaction_demo_match_only"
    BEFORE INSERT ON "DemoTransaction"
    FOR EACH ROW
    EXECUTE FUNCTION "require_demo_match_for_virtual_finance"();

CREATE TRIGGER "DemoWalletHold_demo_match_only"
    BEFORE INSERT ON "DemoWalletHold"
    FOR EACH ROW
    EXECUTE FUNCTION "require_demo_match_for_virtual_finance"();

CREATE FUNCTION "prevent_demo_wallet_hold_reopen"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD."status" <> 'ACTIVE' OR NEW."status" = 'ACTIVE' THEN
        RAISE EXCEPTION 'DemoWalletHold cannot be reopened or changed after closure'
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."walletId" IS DISTINCT FROM OLD."walletId"
        OR NEW."matchId" IS DISTINCT FROM OLD."matchId"
        OR NEW."amount" IS DISTINCT FROM OLD."amount"
        OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
        OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
        OR NEW."closedAt" IS NULL THEN
        RAISE EXCEPTION 'DemoWalletHold identity is immutable and closure must be timestamped'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "DemoWalletHold_no_reopen"
    BEFORE UPDATE ON "DemoWalletHold"
    FOR EACH ROW
    EXECUTE FUNCTION "prevent_demo_wallet_hold_reopen"();
