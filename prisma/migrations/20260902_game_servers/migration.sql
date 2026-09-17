CREATE TYPE "GameServerStatus" AS ENUM ('OFFLINE', 'STARTING', 'READY', 'BUSY', 'STOPPING', 'ERROR');

CREATE TABLE "GameServer" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "status" "GameServerStatus" NOT NULL DEFAULT 'OFFLINE',
    "matchId" UUID,
    "processId" INTEGER,
    "startedAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "lastHeartbeat" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GameServer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GameServer_name_key" ON "GameServer"("name");
CREATE UNIQUE INDEX "GameServer_matchId_key" ON "GameServer"("matchId");
CREATE INDEX "GameServer_status_idx" ON "GameServer"("status");
CREATE INDEX "GameServer_matchId_idx" ON "GameServer"("matchId");

ALTER TABLE "GameServer" ADD CONSTRAINT "GameServer_matchId_fkey"
  FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;
