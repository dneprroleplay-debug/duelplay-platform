CREATE TABLE "AvatarPreset" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "imageData" TEXT NOT NULL,
  "submittedBy" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AvatarPreset_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AvatarPreset_active_sortOrder_idx" ON "AvatarPreset"("active", "sortOrder");
CREATE INDEX "AvatarPreset_createdAt_idx" ON "AvatarPreset"("createdAt");
