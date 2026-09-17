CREATE TABLE "TranslationCache" (
    "id" TEXT NOT NULL,
    "target" VARCHAR(5) NOT NULL,
    "sourceHash" VARCHAR(64) NOT NULL,
    "source" TEXT NOT NULL,
    "translated" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TranslationCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TranslationCache_target_sourceHash_key" ON "TranslationCache"("target", "sourceHash");
CREATE INDEX "TranslationCache_target_idx" ON "TranslationCache"("target");
