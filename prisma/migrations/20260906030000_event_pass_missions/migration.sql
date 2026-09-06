DELETE FROM "EventMissionProgress" a
USING "EventMissionProgress" b
WHERE a.id > b.id
  AND a."eventId" = b."eventId"
  AND a."userId" = b."userId"
  AND a."missionId" = b."missionId";

CREATE UNIQUE INDEX "EventMissionProgress_eventId_userId_missionId_key"
ON "EventMissionProgress"("eventId", "userId", "missionId");
