ALTER TABLE "HolidayTemplate" ADD COLUMN "caseId" UUID;
CREATE INDEX "HolidayTemplate_caseId_idx" ON "HolidayTemplate"("caseId");
ALTER TABLE "HolidayTemplate" ADD CONSTRAINT "HolidayTemplate_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "DuelCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
