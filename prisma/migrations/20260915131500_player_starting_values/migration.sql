-- DuelPlay V31: new players start at Level 0 with a $500 wallet balance.
-- Existing user data is intentionally not modified here; local test data can be reset
-- with scripts/reset-test-users.mjs.
ALTER TABLE "User" ALTER COLUMN "level" SET DEFAULT 0;
ALTER TABLE "Wallet" ALTER COLUMN "balance" SET DEFAULT 500.0000;
