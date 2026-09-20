-- Force re-authentication and remove legacy raw session bearer tokens from database.
ALTER TABLE "UserSession" ADD COLUMN "adminMfaVerifiedAt" TIMESTAMP(3);
UPDATE "UserSession" SET "isRevoked" = true, token = 'REVOKED:' || id::text WHERE "isRevoked" = false OR token NOT LIKE 'REVOKED:%';
