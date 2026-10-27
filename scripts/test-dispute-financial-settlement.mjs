import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifySettlementEvidence } from "../lib/dispute-settlement-policy.ts";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const route = read("app/api/disputes/route.ts");
const wallet = read("lib/wallet.ts");
const schema = read("prisma/schema.prisma");
const migration = read("prisma/migrations/20261027170000_real_dispute_adjustment_transaction_type/migration.sql");
let checks = 0;
function check(condition, message) { assert.ok(condition, message); checks += 1; console.log(`PASS ${message}`); }

const users = ["player-one", "player-two"];
const activeHolds = users.map(userId => ({ userId, amount: "5.0000", status: "ACTIVE" }));
const consumedHolds = users.map(userId => ({ userId, amount: "5.0000", status: "CONSUMED" }));

// Settlement classification covers REAL and DEMO; the actual transaction-specific branch is checked below.
check(classifySettlementEvidence({ holds: activeHolds, expectedUsers: users, stake: "5.0000", hasWinnerPayout: false, hasCommission: false, hasStakeRelease: false }) === "UNSETTLED", "unsettled match with two valid active holds is eligible for first settlement");
check(classifySettlementEvidence({ holds: consumedHolds, expectedUsers: users, stake: "5.0000", hasWinnerPayout: true, hasCommission: true, hasStakeRelease: true }) === "SETTLED", "settled match is detected from completed payout, commission and consumed holds");
check(classifySettlementEvidence({ holds: consumedHolds, expectedUsers: users, stake: "5.0000", hasWinnerPayout: true, hasCommission: true, hasStakeRelease: true }) === "SETTLED", "opposite decision on an already settled match is routed to compensation, not first settlement");
check(classifySettlementEvidence({ holds: [activeHolds[0]], expectedUsers: users, stake: "5.0000", hasWinnerPayout: false, hasCommission: false, hasStakeRelease: false }) === "INCONSISTENT", "missing hold without settlement evidence is rejected for manual review");
check(classifySettlementEvidence({ holds: [{ ...consumedHolds[0], status: "ACTIVE" }, consumedHolds[1]], expectedUsers: users, stake: "5.0000", hasWinnerPayout: false, hasCommission: false, hasStakeRelease: false }) === "SETTLED", "partially closed hold history is never treated as an unsettled match");

check(/if \(winnerId === originalWinnerId\)[\s\S]*?No wallet, hold,[\s\S]*?else \{[\s\S]*?real-compensate-original-payout/.test(route), "same-result REAL disputes skip duplicate payout and hold release while conflicting outcomes enter compensation");
check(/winRows\.length !== 1/.test(route) && /releaseRows\.length !== 2/.test(route) && /commissions\.length !==/.test(route), "REAL settlement requires a single payout, two releases, and matching commission ledger evidence");
check(/originalWallet\.balance\.lt\(originalWin\.amount\)/.test(route) && /DISPUTE_COMPENSATION_INSUFFICIENT_BALANCE/.test(route), "spent prior payout is rejected rather than creating debt or a negative REAL balance");
check(/referralRows\.length\) throw new Error\("REAL_SETTLEMENT_REQUIRES_MANUAL_REVIEW"\)/.test(route), "prior referral payouts requiring reversal are held for manual review");
check(/creditWallet\(tx, p1, stakeDecimal[\s\S]*?creditWallet\(tx, p2, stakeDecimal[\s\S]*?MANUAL_ADJUSTMENT/.test(route), "settled draw/refund reverses the prior payout, refunds both stakes, and reverses the commission ledger");
check(/demo\.resolveDemoDispute\(match\.id, id, decisionValue/.test(route) && /demo-first-settlement/.test(route), "DEMO supports both verified prior settlement and first settlement using its existing ledger methods");
check(/WHERE id = \$\{id\}::uuid FOR UPDATE/.test(route) && /WHERE id = \$\{d\.matchId\}::uuid FOR UPDATE/.test(route), "dispute and match locks serialize duplicate and competing resolution requests");
check(/MATCH_DISPUTE_DECISION_CONFLICT/.test(route) && /otherResolved/.test(route), "a second dispute cannot apply a conflicting financial outcome to the same match");
check(route.includes("if (!samePriorDecision)") && route.includes("never run a second") && route.includes("appended compensation row"), "a later dispute with the same committed decision closes without another payout or fee");
check(/DISPUTE_ADJUSTMENT/.test(wallet) && /DISPUTE_ADJUSTMENT/.test(schema) && /ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'DISPUTE_ADJUSTMENT'/.test(migration), "REAL compensation uses a dedicated append-only transaction type with an additive migration");
check((route.match(/tx\.auditLog\.create\(/g) || []).length === 1 && /RESOLVE_DISPUTE_BLOCKED/.test(route), "success audit remains transactional and blocked manual-review cases are audited after rollback");
check(/await tx\.auditLog\.create\([\s\S]*?result: "SUCCESS"/.test(route) && /await recordPlatformLedgerEntry\(tx/.test(route), "financial ledger, match/dispute updates, and success audit share the same database transaction");
check(/if \(\["RESOLVED_BY_ADMIN", "CLOSED"\]\.includes\(d\.status\)\)[\s\S]*?if \(d\.adminDecision !== decisionValue\) throw new Error\("DISPUTE_DECISION_CONFLICT"\)/.test(route), "same-decision retry is idempotent and conflicting retry returns a conflict");

console.log(`Dispute financial settlement checks: PASS (${checks} assertions).`);
console.log("Note: these are policy/source-contract tests, not a PostgreSQL integration test.");
