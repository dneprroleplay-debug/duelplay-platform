-- Normalize legacy data before enforcing a single stored active season.
WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "startsAt" DESC, "createdAt" DESC, "id" DESC) AS rn
  FROM "Season"
  WHERE "active" = true
)
UPDATE "Season" s
SET "active" = false
FROM ranked r
WHERE s."id" = r."id" AND r.rn > 1;

-- Only one manually/explicitly activated season may be stored as active.
CREATE UNIQUE INDEX IF NOT EXISTS "Season_one_active_idx" ON "Season" ("active") WHERE "active" = true;
