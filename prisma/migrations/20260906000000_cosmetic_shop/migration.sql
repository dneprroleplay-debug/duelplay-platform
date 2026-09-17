CREATE TABLE IF NOT EXISTS "CosmeticItem" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "slug" TEXT NOT NULL, "name" TEXT NOT NULL, "type" TEXT NOT NULL,
  "price" DECIMAL(20,4) NOT NULL, "imageUrl" TEXT, "active" BOOLEAN NOT NULL DEFAULT true, "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "CosmeticItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CosmeticItem_slug_key" ON "CosmeticItem"("slug");
CREATE TABLE IF NOT EXISTS "CosmeticPurchase" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "userId" UUID NOT NULL, "itemId" UUID NOT NULL, "price" DECIMAL(20,4) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "CosmeticPurchase_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CosmeticPurchase_userId_itemId_key" ON "CosmeticPurchase"("userId","itemId");
CREATE INDEX IF NOT EXISTS "CosmeticPurchase_userId_idx" ON "CosmeticPurchase"("userId");
CREATE INDEX IF NOT EXISTS "CosmeticPurchase_itemId_idx" ON "CosmeticPurchase"("itemId");
DO $$ BEGIN
  ALTER TABLE "CosmeticPurchase" ADD CONSTRAINT "CosmeticPurchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "CosmeticPurchase" ADD CONSTRAINT "CosmeticPurchase_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CosmeticItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
