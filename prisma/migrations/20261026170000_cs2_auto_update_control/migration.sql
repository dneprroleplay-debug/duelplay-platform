CREATE TABLE "Cs2UpdateRun" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "localDate" VARCHAR(10) NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "scheduledLocalTime" VARCHAR(5) NOT NULL,
    "timeZone" VARCHAR(64) NOT NULL DEFAULT 'Europe/Kyiv',
    "scheduleRevision" INTEGER NOT NULL,
    "source" VARCHAR(24) NOT NULL DEFAULT 'SCHEDULED',
    "status" VARCHAR(40) NOT NULL,
    "stage" VARCHAR(80) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "publicBuildId" VARCHAR(32),
    "installedBuildIdBefore" VARCHAR(32),
    "installedBuildIdAfter" VARCHAR(32),
    "serverVersionAfter" VARCHAR(32),
    "checkedInstances" JSONB,
    "diagnostics" JSONB,
    "errorCode" VARCHAR(80),
    "errorMessage" VARCHAR(1000),
    "interventionRequired" BOOLEAN NOT NULL DEFAULT false,
    "maintenanceWasEnabled" BOOLEAN NOT NULL DEFAULT false,
    "maintenanceEnabled" BOOLEAN NOT NULL DEFAULT false,
    "syncMarkerActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Cs2UpdateRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Cs2UpdateRun_localDate_key" ON "Cs2UpdateRun"("localDate");
CREATE INDEX "Cs2UpdateRun_startedAt_idx" ON "Cs2UpdateRun"("startedAt");
CREATE INDEX "Cs2UpdateRun_status_startedAt_idx" ON "Cs2UpdateRun"("status", "startedAt");

INSERT INTO "SiteSettings" ("id", "key", "value", "description", "updatedBy", "updatedAt")
VALUES (
  gen_random_uuid(),
  'CS2_AUTO_UPDATE_SCHEDULE',
  jsonb_build_object('enabled', true, 'localTime', '05:00', 'timeZone', 'Europe/Kyiv', 'revision', 1, 'scheduleChangedAt', CURRENT_TIMESTAMP, 'lastCheckedAt', NULL, 'agentStatus', 'UNKNOWN', 'agentError', NULL),
  'Central CS2 automatic update schedule',
  NULL,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;
