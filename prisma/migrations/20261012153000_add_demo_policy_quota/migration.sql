-- Add server-side policy and immutable usage records for future DEMO match starts.
-- This migration does not change REAL finance tables or connect DEMO to match APIs.

CREATE TYPE "DemoMatchStartReservationStatus" AS ENUM ('RESERVED', 'CONSUMED', 'RELEASED');

CREATE TABLE "DemoModeSettings" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "dailyMatchLimit" INTEGER NOT NULL DEFAULT 3,
    "timeZone" VARCHAR(64) NOT NULL DEFAULT 'Europe/Kyiv',
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedById" UUID,
    CONSTRAINT "DemoModeSettings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DemoModeSettings_singleton_id_check" CHECK ("id" = 'global'),
    CONSTRAINT "DemoModeSettings_dailyMatchLimit_nonnegative" CHECK ("dailyMatchLimit" >= 0),
    CONSTRAINT "DemoModeSettings_timeZone_check" CHECK ("timeZone" = 'Europe/Kyiv'),
    CONSTRAINT "DemoModeSettings_updatedById_fkey" FOREIGN KEY ("updatedById")
        REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "DemoModeSettings" ("id", "enabled", "dailyMatchLimit", "timeZone", "updatedAt")
VALUES ('global', false, 3, 'Europe/Kyiv', CURRENT_TIMESTAMP);

CREATE TABLE "DemoUserPolicy" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "reason" VARCHAR(1000),
    "changedById" UUID NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "DemoUserPolicy_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DemoUserPolicy_userId_key" UNIQUE ("userId"),
    CONSTRAINT "DemoUserPolicy_block_reason_check" CHECK (
        NOT "blocked" OR (
            "reason" IS NOT NULL AND
            length(regexp_replace("reason", '[[:space:]]', '', 'g')) > 0
        )
    ),
    CONSTRAINT "DemoUserPolicy_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DemoUserPolicy_changedById_fkey" FOREIGN KEY ("changedById")
        REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "DemoMatchStartReservation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "matchId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "localDay" DATE NOT NULL,
    "status" "DemoMatchStartReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "reservedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" TIMESTAMPTZ(3),
    "releasedAt" TIMESTAMPTZ(3),
    CONSTRAINT "DemoMatchStartReservation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DemoMatchStartReservation_matchId_userId_key" UNIQUE ("matchId", "userId"),
    CONSTRAINT "DemoMatchStartReservation_status_timestamps_check" CHECK (
        ("status" = 'RESERVED' AND "consumedAt" IS NULL AND "releasedAt" IS NULL) OR
        ("status" = 'CONSUMED' AND "consumedAt" IS NOT NULL AND "releasedAt" IS NULL) OR
        ("status" = 'RELEASED' AND "consumedAt" IS NULL AND "releasedAt" IS NOT NULL)
    ),
    CONSTRAINT "DemoMatchStartReservation_matchId_fkey" FOREIGN KEY ("matchId")
        REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DemoMatchStartReservation_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "DemoMatchStartReservation_userId_localDay_status_idx"
    ON "DemoMatchStartReservation"("userId", "localDay", "status");
CREATE INDEX "DemoMatchStartReservation_matchId_status_idx"
    ON "DemoMatchStartReservation"("matchId", "status");

CREATE FUNCTION "validate_demo_match_start_reservation"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    match_economy "MatchEconomyMode";
    match_status "MatchStatus";
    player_one UUID;
    player_two UUID;
BEGIN
    SELECT "economyMode", "status", "playerOneId", "playerTwoId"
      INTO match_economy, match_status, player_one, player_two
      FROM "Match"
      WHERE "id" = NEW."matchId";
    IF NOT FOUND OR match_economy <> 'DEMO' OR match_status NOT IN ('READY', 'STARTING') OR player_two IS NULL
       OR (NEW."userId" IS DISTINCT FROM player_one AND NEW."userId" IS DISTINCT FROM player_two) THEN
        RAISE EXCEPTION 'DemoMatchStartReservation must reference a ready DEMO match participant'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "DemoMatchStartReservation_demo_participant"
    BEFORE INSERT ON "DemoMatchStartReservation"
    FOR EACH ROW
    EXECUTE FUNCTION "validate_demo_match_start_reservation"();

CREATE TABLE "DemoMatchUsage" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "matchId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "localDay" DATE NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "DemoMatchUsage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DemoMatchUsage_matchId_userId_key" UNIQUE ("matchId", "userId"),
    CONSTRAINT "DemoMatchUsage_matchId_fkey" FOREIGN KEY ("matchId")
        REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DemoMatchUsage_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "DemoMatchUsage_userId_localDay_idx"
    ON "DemoMatchUsage"("userId", "localDay");

CREATE FUNCTION "validate_demo_match_usage"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    match_economy "MatchEconomyMode";
    match_status "MatchStatus";
    player_one UUID;
    player_two UUID;
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
    IF NEW."localDay" <> (NEW."startedAt" AT TIME ZONE 'Europe/Kyiv')::date THEN
        RAISE EXCEPTION 'DemoMatchUsage localDay must match startedAt in Europe/Kyiv'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "DemoMatchUsage_valid_live_demo_match"
    BEFORE INSERT ON "DemoMatchUsage"
    FOR EACH ROW
    EXECUTE FUNCTION "validate_demo_match_usage"();

CREATE FUNCTION "prevent_demo_match_usage_mutation"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'DemoMatchUsage history is immutable'
        USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER "DemoMatchUsage_immutable_rows"
    BEFORE UPDATE OR DELETE ON "DemoMatchUsage"
    FOR EACH ROW
    EXECUTE FUNCTION "prevent_demo_match_usage_mutation"();

CREATE TRIGGER "DemoMatchUsage_no_truncate"
    BEFORE TRUNCATE ON "DemoMatchUsage"
    FOR EACH STATEMENT
    EXECUTE FUNCTION "prevent_demo_match_usage_mutation"();
