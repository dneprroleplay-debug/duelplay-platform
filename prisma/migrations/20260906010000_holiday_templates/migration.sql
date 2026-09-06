CREATE TABLE "HolidayTemplate" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "icon" TEXT,
  "theme" TEXT NOT NULL,
  "month" INTEGER NOT NULL,
  "day" INTEGER NOT NULL,
  "durationDays" INTEGER NOT NULL DEFAULT 1,
  "effects" JSONB,
  "missions" JSONB,
  "rewards" JSONB,
  "eventPass" BOOLEAN NOT NULL DEFAULT false,
  "premiumPass" BOOLEAN NOT NULL DEFAULT false,
  "promoMultiplier" DECIMAL(8,2) NOT NULL DEFAULT 1,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HolidayTemplate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HolidayTemplate_slug_key" ON "HolidayTemplate"("slug");
CREATE INDEX "HolidayTemplate_active_month_day_idx" ON "HolidayTemplate"("active","month","day");
ALTER TABLE "HolidayTemplate" ADD CONSTRAINT "HolidayTemplate_month_check" CHECK ("month" BETWEEN 1 AND 12);
ALTER TABLE "HolidayTemplate" ADD CONSTRAINT "HolidayTemplate_day_check" CHECK ("day" BETWEEN 1 AND 31);
ALTER TABLE "HolidayTemplate" ADD CONSTRAINT "HolidayTemplate_duration_check" CHECK ("durationDays" BETWEEN 1 AND 31);
ALTER TABLE "HolidayTemplate" ADD CONSTRAINT "HolidayTemplate_multiplier_check" CHECK ("promoMultiplier" >= 1 AND "promoMultiplier" <= 100);
