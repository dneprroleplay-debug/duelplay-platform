ALTER TABLE "User" ADD COLUMN "isTestAccount" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "User_isTestAccount_idx" ON "User"("isTestAccount");
