CREATE TABLE "SteamTrade" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "inventoryItemId" UUID NOT NULL,
  "steamId" TEXT NOT NULL,
  "steamAssetId" TEXT NOT NULL,
  "externalTradeId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'TRADE_PENDING',
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SteamTrade_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SteamTrade_externalTradeId_key" ON "SteamTrade"("externalTradeId");
CREATE UNIQUE INDEX "SteamTrade_inventoryItemId_key" ON "SteamTrade"("inventoryItemId");
CREATE INDEX "SteamTrade_userId_createdAt_idx" ON "SteamTrade"("userId", "createdAt");
CREATE INDEX "SteamTrade_status_updatedAt_idx" ON "SteamTrade"("status", "updatedAt");
ALTER TABLE "SteamTrade" ADD CONSTRAINT "SteamTrade_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SteamTrade" ADD CONSTRAINT "SteamTrade_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
