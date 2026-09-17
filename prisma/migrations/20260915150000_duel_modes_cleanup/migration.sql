-- DuelPlay V34: add Grenade Only and remove the obsolete High Stakes mode.
-- Historical HIGH_STAKES rows are normalized to SOLO_1V1 because High Stakes was
-- an economic setting, not a distinct gameplay ruleset.
BEGIN;

CREATE TYPE "MatchMode_new" AS ENUM (
  'SOLO_1V1',
  'TEAM_5V5',
  'WINGMAN_2V2',
  'DEATHMATCH',
  'AWP_ONLY',
  'DEAGLE_ONLY',
  'KNIFE_ONLY',
  'HEADSHOT_ONLY',
  'RANDOM_WEAPON',
  'FIRST_TO_10',
  'GRENADE_ONLY'
);

ALTER TABLE "Match"
  ALTER COLUMN "mode" TYPE "MatchMode_new"
  USING (
    CASE WHEN "mode"::text = 'HIGH_STAKES' THEN 'SOLO_1V1' ELSE "mode"::text END
  )::"MatchMode_new";

DROP TYPE "MatchMode";
ALTER TYPE "MatchMode_new" RENAME TO "MatchMode";

COMMIT;
