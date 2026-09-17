CREATE INDEX "Notification_user_status_createdAt_idx"
ON "Notification"("userId", "status", "createdAt" DESC);
