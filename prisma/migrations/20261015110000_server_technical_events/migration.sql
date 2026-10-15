CREATE TABLE "ServerIncident" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "dedupeKey" VARCHAR(160) NOT NULL,
  "serverName" VARCHAR(64) NOT NULL,
  "category" VARCHAR(64) NOT NULL,
  "severity" VARCHAR(16) NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "message" VARCHAR(500) NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'OPEN',
  "occurrences" INTEGER NOT NULL DEFAULT 1,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgedAt" TIMESTAMP(3),
  "acknowledgedById" UUID,
  "resolution" JSONB,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServerIncident_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ServerTechnicalEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "eventId" VARCHAR(128) NOT NULL,
  "serverName" VARCHAR(64) NOT NULL,
  "source" VARCHAR(64) NOT NULL,
  "category" VARCHAR(64) NOT NULL,
  "severity" VARCHAR(16) NOT NULL,
  "message" VARCHAR(500) NOT NULL,
  "details" JSONB,
  "correlationId" VARCHAR(128),
  "matchId" UUID,
  "result" VARCHAR(64),
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "incidentId" UUID,
  CONSTRAINT "ServerTechnicalEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServerIncident_dedupeKey_key" ON "ServerIncident"("dedupeKey");
CREATE INDEX "ServerIncident_status_lastSeenAt_idx" ON "ServerIncident"("status", "lastSeenAt");
CREATE INDEX "ServerIncident_serverName_status_idx" ON "ServerIncident"("serverName", "status");
CREATE INDEX "ServerIncident_severity_status_idx" ON "ServerIncident"("severity", "status");
CREATE UNIQUE INDEX "ServerTechnicalEvent_eventId_key" ON "ServerTechnicalEvent"("eventId");
CREATE INDEX "ServerTechnicalEvent_serverName_occurredAt_idx" ON "ServerTechnicalEvent"("serverName", "occurredAt");
CREATE INDEX "ServerTechnicalEvent_severity_occurredAt_idx" ON "ServerTechnicalEvent"("severity", "occurredAt");
CREATE INDEX "ServerTechnicalEvent_category_occurredAt_idx" ON "ServerTechnicalEvent"("category", "occurredAt");
CREATE INDEX "ServerTechnicalEvent_incidentId_occurredAt_idx" ON "ServerTechnicalEvent"("incidentId", "occurredAt");

ALTER TABLE "ServerIncident" ADD CONSTRAINT "ServerIncident_serverName_fkey" FOREIGN KEY ("serverName") REFERENCES "GameServer"("name") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServerIncident" ADD CONSTRAINT "ServerIncident_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ServerTechnicalEvent" ADD CONSTRAINT "ServerTechnicalEvent_serverName_fkey" FOREIGN KEY ("serverName") REFERENCES "GameServer"("name") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServerTechnicalEvent" ADD CONSTRAINT "ServerTechnicalEvent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "ServerIncident"("id") ON DELETE SET NULL ON UPDATE CASCADE;
