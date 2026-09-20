ALTER TABLE "AuditLog" ADD COLUMN "requestId" VARCHAR(128);
ALTER TABLE "AuditLog" ADD COLUMN "result" VARCHAR(32);
ALTER TABLE "AuditLog" ADD COLUMN "reason" VARCHAR(1000);

CREATE INDEX "AuditLog_requestId_idx" ON "AuditLog"("requestId");
CREATE INDEX "AuditLog_result_idx" ON "AuditLog"("result");
