ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "equippedBannerItemId" UUID;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "equippedTitleItemId" UUID;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'User_equippedBannerItemId_fkey') THEN
    ALTER TABLE "User" ADD CONSTRAINT "User_equippedBannerItemId_fkey" FOREIGN KEY ("equippedBannerItemId") REFERENCES "CosmeticItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'User_equippedTitleItemId_fkey') THEN
    ALTER TABLE "User" ADD CONSTRAINT "User_equippedTitleItemId_fkey" FOREIGN KEY ("equippedTitleItemId") REFERENCES "CosmeticItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
