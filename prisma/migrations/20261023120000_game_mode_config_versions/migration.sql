ALTER TYPE "MatchMode" ADD VALUE IF NOT EXISTS 'LOW_GRAVITY';
ALTER TYPE "MatchMode" ADD VALUE IF NOT EXISTS 'SPEED_DUEL';

CREATE TYPE "GameModeConfigRevisionStatus" AS ENUM ('DRAFT', 'PENDING_SYNC', 'PUBLISHED', 'SUPERSEDED');
CREATE TYPE "GameModeConfigServerAckStatus" AS ENUM ('PENDING', 'STAGED', 'APPLIED', 'FAILED');

CREATE TABLE "GameModeConfigRevision" (
    "version" SERIAL NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "config" JSONB NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "status" "GameModeConfigRevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "rollbackOfVersion" INTEGER,
    CONSTRAINT "GameModeConfigRevision_pkey" PRIMARY KEY ("version")
);

CREATE TABLE "GameModeConfigState" (
    "key" VARCHAR(32) NOT NULL DEFAULT 'global',
    "draftVersion" INTEGER,
    "publishedVersion" INTEGER,
    "pendingVersion" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GameModeConfigState_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "GameModeConfigServerAck" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "revisionVersion" INTEGER NOT NULL,
    "serverName" VARCHAR(64) NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "modeControllerVersion" VARCHAR(64),
    "capabilities" JSONB,
    "status" "GameModeConfigServerAckStatus" NOT NULL DEFAULT 'PENDING',
    "error" VARCHAR(500),
    "stagedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GameModeConfigServerAck_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "GameModeConfigRevision"
  ADD CONSTRAINT "GameModeConfigRevision_rollbackOfVersion_fkey"
  FOREIGN KEY ("rollbackOfVersion") REFERENCES "GameModeConfigRevision"("version") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GameModeConfigState"
  ADD CONSTRAINT "GameModeConfigState_draftVersion_fkey"
  FOREIGN KEY ("draftVersion") REFERENCES "GameModeConfigRevision"("version") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "GameModeConfigState_publishedVersion_fkey"
  FOREIGN KEY ("publishedVersion") REFERENCES "GameModeConfigRevision"("version") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "GameModeConfigState_pendingVersion_fkey"
  FOREIGN KEY ("pendingVersion") REFERENCES "GameModeConfigRevision"("version") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GameModeConfigServerAck"
  ADD CONSTRAINT "GameModeConfigServerAck_revisionVersion_fkey"
  FOREIGN KEY ("revisionVersion") REFERENCES "GameModeConfigRevision"("version") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MatchGameModeConfigSnapshot" (
    "matchId" UUID NOT NULL,
    "revisionVersion" INTEGER,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MatchGameModeConfigSnapshot_pkey" PRIMARY KEY ("matchId")
);

ALTER TABLE "MatchGameModeConfigSnapshot"
  ADD CONSTRAINT "MatchGameModeConfigSnapshot_matchId_fkey"
  FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "MatchGameModeConfigSnapshot_revisionVersion_fkey"
  FOREIGN KEY ("revisionVersion") REFERENCES "GameModeConfigRevision"("version") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "GameModeConfigState_draftVersion_key" ON "GameModeConfigState"("draftVersion");
CREATE UNIQUE INDEX "GameModeConfigState_publishedVersion_key" ON "GameModeConfigState"("publishedVersion");
CREATE UNIQUE INDEX "GameModeConfigState_pendingVersion_key" ON "GameModeConfigState"("pendingVersion");
CREATE INDEX "GameModeConfigRevision_status_createdAt_idx" ON "GameModeConfigRevision"("status", "createdAt");
CREATE INDEX "GameModeConfigRevision_createdById_createdAt_idx" ON "GameModeConfigRevision"("createdById", "createdAt");
CREATE UNIQUE INDEX "GameModeConfigServerAck_revisionVersion_serverName_key" ON "GameModeConfigServerAck"("revisionVersion", "serverName");
CREATE INDEX "GameModeConfigServerAck_serverName_status_updatedAt_idx" ON "GameModeConfigServerAck"("serverName", "status", "updatedAt");
CREATE INDEX "MatchGameModeConfigSnapshot_revisionVersion_idx" ON "MatchGameModeConfigSnapshot"("revisionVersion");
