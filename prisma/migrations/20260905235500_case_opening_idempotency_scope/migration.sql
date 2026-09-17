-- Scope case-opening idempotency to the owning user. A client-generated key must
-- never allow another user to retrieve the first user's case result.
DROP INDEX IF EXISTS "CaseOpening_idempotencyKey_key";
CREATE UNIQUE INDEX "CaseOpening_userId_idempotencyKey_key" ON "CaseOpening"("userId", "idempotencyKey");
