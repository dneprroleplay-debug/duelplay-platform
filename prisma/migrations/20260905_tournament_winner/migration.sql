ALTER TABLE "Tournament" ADD COLUMN IF NOT EXISTS "winnerId" UUID;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Tournament_winnerId_fkey') THEN
    ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "Tournament_winnerId_idx" ON "Tournament"("winnerId");
