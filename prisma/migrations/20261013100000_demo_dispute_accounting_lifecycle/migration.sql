-- Keep append-only DEMO settlement history while correcting a result after a
-- post-settlement dispute. Any unrecovered virtual payout is a non-spendable
-- liability on the DEMO wallet, repaid from later incoming DEMO credits.

ALTER TABLE "DemoWallet"
    ADD COLUMN "debtBalance" DECIMAL(20,4) NOT NULL DEFAULT 0.0000,
    ADD CONSTRAINT "DemoWallet_debtBalance_nonnegative" CHECK ("debtBalance" >= 0);

ALTER TABLE "DemoTransaction"
    DROP CONSTRAINT "DemoTransaction_wallet_context_check",
    DROP CONSTRAINT "DemoTransaction_match_context_check",
    DROP CONSTRAINT "DemoTransaction_amount_semantics_check";

ALTER TABLE "DemoTransaction"
    ADD CONSTRAINT "DemoTransaction_wallet_context_check" CHECK (
        ("type" IN ('MATCH_FEE', 'MATCH_FEE_ADJUSTMENT') AND "walletId" IS NULL AND "userId" IS NULL
            AND "balanceBefore" IS NULL AND "balanceAfter" IS NULL AND "matchId" IS NOT NULL)
        OR
        ("type" NOT IN ('MATCH_FEE', 'MATCH_FEE_ADJUSTMENT') AND "walletId" IS NOT NULL AND "userId" IS NOT NULL
            AND "balanceBefore" IS NOT NULL AND "balanceAfter" IS NOT NULL)
    ),
    ADD CONSTRAINT "DemoTransaction_match_context_check" CHECK (
        "type" NOT IN ('MATCH_STAKE', 'MATCH_STAKE_LOCK', 'MATCH_STAKE_RELEASE', 'MATCH_REFUND', 'MATCH_WIN', 'MATCH_FEE', 'MATCH_FEE_ADJUSTMENT', 'DISPUTE_ADJUSTMENT')
        OR "matchId" IS NOT NULL
    ),
    ADD CONSTRAINT "DemoTransaction_amount_semantics_check" CHECK (
        ("type" = 'MATCH_STAKE' AND "amount" < 0)
        OR ("type" IN ('MATCH_STAKE_LOCK', 'MATCH_STAKE_RELEASE') AND "amount" = 0)
        OR ("type" = 'STARTER_GRANT' AND "amount" >= 0)
        OR ("type" IN ('MATCH_REFUND', 'MATCH_WIN') AND "amount" >= 0)
        OR ("type" = 'MATCH_FEE' AND "amount" > 0)
        OR ("type" = 'MATCH_FEE_ADJUSTMENT' AND "amount" <> 0)
        OR ("type" = 'DISPUTE_ADJUSTMENT' AND "amount" < 0)
        OR ("type" = 'DEBT_ADJUSTMENT' AND "amount" <> 0 AND "balanceBefore" = "balanceAfter")
        OR ("type" = 'BALANCE_ADJUSTMENT')
    );

-- A consumed reservation retains the Kyiv calendar day charged at reservation
-- time. A LIVE transition after midnight records usage against that same day.
-- startedAt remains the real UTC instant of the match start.
CREATE OR REPLACE FUNCTION "validate_demo_match_usage"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    match_economy "MatchEconomyMode";
    match_status "MatchStatus";
    player_one UUID;
    player_two UUID;
    reserved_day DATE;
BEGIN
    SELECT "economyMode", "status", "playerOneId", "playerTwoId"
      INTO match_economy, match_status, player_one, player_two
      FROM "Match"
      WHERE "id" = NEW."matchId";
    IF NOT FOUND OR match_economy <> 'DEMO' OR match_status <> 'LIVE' OR player_two IS NULL
       OR (NEW."userId" IS DISTINCT FROM player_one AND NEW."userId" IS DISTINCT FROM player_two) THEN
        RAISE EXCEPTION 'DemoMatchUsage must reference a LIVE DEMO match participant'
            USING ERRCODE = 'check_violation';
    END IF;
    SELECT "localDay" INTO reserved_day
      FROM "DemoMatchStartReservation"
      WHERE "matchId" = NEW."matchId" AND "userId" = NEW."userId"
        AND "status" = 'CONSUMED'::"DemoMatchStartReservationStatus";
    IF NOT FOUND OR NEW."localDay" IS DISTINCT FROM reserved_day THEN
        RAISE EXCEPTION 'DemoMatchUsage must preserve the consumed reservation quota day'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;
