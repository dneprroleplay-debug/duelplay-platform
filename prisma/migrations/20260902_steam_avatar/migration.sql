-- Store the current Steam profile avatar separately so users can customize/remove their site avatar without losing the Steam photo.
ALTER TABLE "User" ADD COLUMN "steamAvatarUrl" TEXT;
UPDATE "User" SET "steamAvatarUrl" = "avatarUrl" WHERE "steamId" IS NOT NULL AND "avatarUrl" IS NOT NULL;
