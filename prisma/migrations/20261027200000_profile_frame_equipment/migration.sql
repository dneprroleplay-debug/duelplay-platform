ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "equippedFrameItemId" UUID;
ALTER TABLE "User" ADD CONSTRAINT "User_equippedFrameItemId_fkey" FOREIGN KEY ("equippedFrameItemId") REFERENCES "CosmeticItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
INSERT INTO "CosmeticItem" ("slug", "name", "type", "price", "active", "metadata")
VALUES ('frame-profile-complete', 'DuelPlay Complete', 'FRAME', 0, TRUE, '{"nonPayToWin":true,"profileCompletionReward":true}'::jsonb)
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "CosmeticPurchase" ("userId", "itemId", "price")
SELECT rg."userId", ci."id", 0
FROM "RewardGrant" rg
JOIN "CosmeticItem" ci ON ci."slug" = 'frame-profile-complete'
WHERE rg."idempotencyKey" LIKE 'profile-completion-avatar-v1:%'
ON CONFLICT ("userId", "itemId") DO NOTHING;
