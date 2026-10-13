-- Add DEMO dispute accounting transaction types in their own migration.
-- PostgreSQL requires the enum additions to commit before later migrations
-- can safely use these values in constraints or data operations.
ALTER TYPE "DemoTransactionType" ADD VALUE IF NOT EXISTS 'MATCH_FEE_ADJUSTMENT';
ALTER TYPE "DemoTransactionType" ADD VALUE IF NOT EXISTS 'DISPUTE_ADJUSTMENT';
ALTER TYPE "DemoTransactionType" ADD VALUE IF NOT EXISTS 'DEBT_ADJUSTMENT';
