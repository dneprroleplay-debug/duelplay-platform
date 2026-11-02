-- Allow more than one controlled CS2 update run per calendar day while keeping
-- each scheduled occurrence and each Steam public Build ID idempotent.
ALTER TABLE "Cs2UpdateRun" ADD COLUMN "sourceKey" VARCHAR(64);
UPDATE "Cs2UpdateRun" SET "sourceKey" = 'scheduled:' || "localDate" WHERE "source" = 'SCHEDULED';
DROP INDEX IF EXISTS "Cs2UpdateRun_localDate_key";
CREATE UNIQUE INDEX "Cs2UpdateRun_sourceKey_key" ON "Cs2UpdateRun"("sourceKey");
