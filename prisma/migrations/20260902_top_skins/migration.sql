CREATE TABLE "TopSkin" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "imageData" TEXT NOT NULL,
  "submittedBy" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TopSkin_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TopSkin_active_sortOrder_idx" ON "TopSkin"("active", "sortOrder");
CREATE INDEX "TopSkin_createdAt_idx" ON "TopSkin"("createdAt");
