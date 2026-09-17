-- DuelPlay cases and player inventory
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'CASE_OPEN';

CREATE TABLE "DuelCase" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "price" DECIMAL(20,4) NOT NULL,
  "imageUrl" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DuelCase_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DuelCase_slug_key" ON "DuelCase"("slug");
CREATE INDEX "DuelCase_active_idx" ON "DuelCase"("active");

CREATE TABLE "DuelCaseItem" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "caseId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "imageUrl" TEXT NOT NULL,
  "rarity" TEXT NOT NULL,
  "value" DECIMAL(20,4) NOT NULL,
  "weight" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DuelCaseItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DuelCaseItem_caseId_idx" ON "DuelCaseItem"("caseId");

CREATE TABLE "InventoryItem" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "caseId" UUID,
  "caseItemId" UUID,
  "name" TEXT NOT NULL,
  "imageUrl" TEXT NOT NULL,
  "rarity" TEXT NOT NULL,
  "value" DECIMAL(20,4) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
  "steamAssetId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "InventoryItem_userId_createdAt_idx" ON "InventoryItem"("userId","createdAt");
CREATE INDEX "InventoryItem_status_idx" ON "InventoryItem"("status");

ALTER TABLE "DuelCaseItem" ADD CONSTRAINT "DuelCaseItem_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "DuelCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "DuelCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_caseItemId_fkey" FOREIGN KEY ("caseItemId") REFERENCES "DuelCaseItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
