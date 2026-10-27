import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isRecoveryNoticeEligible, isRecoveryRestoreEligible } from '../lib/account-recovery-policy.ts';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const deletion = read('app/api/admin/access/permanent-delete/route.ts');
const recovery = read('lib/account-recovery.ts');
const policy = read('lib/account-recovery-policy.ts');
const verify = read('app/api/auth/verify-email/route.ts');
const verifyUi = read('app/verify-email/page.tsx');
const steam = read('app/api/auth/steam/callback/route.ts');
const schema = read('prisma/schema.prisma');
const migration = read('prisma/migrations/20261027130000_account_balance_recovery/migration.sql');
const wallet = read('lib/wallet.ts');
const audit = read('scripts/test-audit-policy.mjs');
let checks = 0;
function test(condition, name) { assert.ok(condition, name); checks++; }
function has(source, pattern, name) { test(pattern.test(source), name); }

// Deletion: demo is annulled, real is held, and all mutations share the same transaction.

// Executable policy tests (same pure policy functions used by production code).
const noticeBase = { emailConfirmed: true, status: "AVAILABLE", realBalance: "12.5000", sourceLedgerMatches: true, holdLedgerMatches: true, oldAccountAnonymized: true, oldWalletZero: true, laterLedgerCount: 0 };
test(isRecoveryNoticeEligible(noticeBase), 'positive confirmed REAL balance with verified ledger shows the notice');
test(!isRecoveryNoticeEligible({ ...noticeBase, status: "NONE" }), 'ordinary new user receives no recovery notice');
test(!isRecoveryNoticeEligible({ ...noticeBase, realBalance: "0.0000" }), 'DEMO-only account receives no REAL recovery notice');
test(!isRecoveryNoticeEligible({ ...noticeBase, laterLedgerCount: 1 }), 'spent/returned/payout ledger activity suppresses the notice');
test(!isRecoveryNoticeEligible({ ...noticeBase, status: "RESTORED" }), 'already-restored recovery receives no notice');
test(!isRecoveryNoticeEligible({ ...noticeBase, sourceLedgerMatches: false }), 'unverified source ledger suppresses the notice');
test(!isRecoveryNoticeEligible({ ...noticeBase, holdLedgerMatches: false }), 'missing or altered hold ledger suppresses the notice');
test(!isRecoveryNoticeEligible({ ...noticeBase, oldWalletZero: false }), 'nonzero old wallet suppresses the notice');
test(!isRecoveryNoticeEligible({ ...noticeBase, emailConfirmed: false }), 'unconfirmed email cannot see the notice');
const restoreBase = { emailHmacMatches: true, steamHmacMatches: true, emailConfirmed: true, activeNewAccount: true, isDifferentInternalAccount: true, recoveryAvailable: true, ledgerVerified: true };
test(isRecoveryRestoreEligible(restoreBase), 'exact confirmed email and Steam identity restores eligible balance');
test(!isRecoveryRestoreEligible({ ...restoreBase, steamHmacMatches: false }), 'matching email with a different Steam ID never restores funds');
test(!isRecoveryRestoreEligible({ ...restoreBase, emailHmacMatches: false }), 'matching Steam with a different email never restores funds');
test(!isRecoveryRestoreEligible({ ...restoreBase, recoveryAvailable: false }), 'recovery cannot be consumed twice');
test(!isRecoveryRestoreEligible({ ...restoreBase, ledgerVerified: false }), 'unverified financial ledger cannot be credited');
test(!isRecoveryRestoreEligible({ ...restoreBase, activeNewAccount: false }), 'inactive or deleted new account cannot receive funds');
test(!isRecoveryRestoreEligible({ ...restoreBase, isDifferentInternalAccount: false }), 'old internal account cannot recover into itself');
has(deletion, /demo\.adjustDemoCredits\(targetId, beforeDemo\.negated\(\)/, 'DEMO balance is annulled through existing DEMO ledger');
test(!/demo\.adjustDemoCredits\(actorId/.test(deletion), 'DEMO balance is never transferred to the administrator');
has(deletion, /if \(beforeReal\.gt\(0\)\)/, 'positive REAL balance does not by itself block deletion');
has(wallet, /type:"ACCOUNT_DELETION_RECOVERY_HOLD"/, 'REAL balance is moved to a non-spendable ledger hold');
has(deletion, /secureWalletForAccountRecovery/, 'deletion uses the dedicated existing-wallet ledger helper');
has(wallet, /data:\{balance:after\}/, 'old wallet spendable balance is zeroed through wallet ledger helper');
has(deletion, /tx\.accountRecovery\.create/, 'protected recovery row is created atomically');
has(deletion, /withDemoTransaction\(async/, 'DEMO and REAL changes share one transaction boundary');
has(deletion, /Prisma\.TransactionIsolationLevel\.Serializable/, 'deletion uses serializable isolation');
has(deletion, /if \(!realBonus\.eq\(0\)\) reasonCodes\.push\("BONUS_BALANCE_UNRESOLVED"\)/, 'bonus funds are handled separately rather than treated as REAL');
has(deletion, /ACTIVE_MATCH_STATUSES/, 'active matches still block deletion');
has(deletion, /ACTIVE_DISPUTE_STATUSES/, 'active disputes still block deletion');
has(deletion, /LOCKED_FUNDS/, 'locked funds and holds still block deletion');
has(deletion, /FINANCIAL_OPERATION_PENDING/, 'pending financial operations still block deletion');
has(deletion, /FOUNDER_999_REQUIRED/, 'FOUNDER level 999 RBAC remains enforced');
has(deletion, /ADMIN_MFA_REQUIRED/, 'MFA errors remain enforced');
has(deletion, /CSRF_ORIGIN_REJECTED/, 'same-origin CSRF protection remains enforced');
has(deletion, /confirmNickname/, 'nickname re-entry remains required');
has(deletion, /REASON_REQUIRED/, 'deletion reason remains required');
has(deletion, /tx\.userSession\.deleteMany/, 'old sessions are invalidated');
has(deletion, /email: null, emailVerifiedAt: null, passwordHash: null, steamId: null/, 'email and Steam identifiers are freed');
test(!/tx\.(?:wallet|transaction|demoTransaction|match|dispute)\.deleteMany/.test(deletion), 'historical finance and game rows are preserved');

// Recovery notice: only verified email + AVAILABLE positive balance + matching ledger hold.
has(verify, /findAvailableRecoveryForEmail\(prisma, email\)/, 'notice lookup occurs after email confirmation');
has(verify, /recoveryAvailable,/, 'server returns an eligibility boolean, not a balance');
has(verifyUi, /data\.recoveryAvailable === true/, 'ordinary users do not see recovery notice');
has(verifyUi, /data\.recoveryMessage/, 'only the server-approved notice text is shown');
has(recovery, /status: ACCOUNT_RECOVERY_AVAILABLE, realBalance: \{ gt: new Prisma\.Decimal\(0\) \}/, 'notice requires AVAILABLE positive REAL balance');
has(recovery, /ACCOUNT_DELETION_RECOVERY_HOLD/, 'notice validates the recovery hold ledger type');
has(recovery, /source\.balanceAfter\.eq\(row\.realBalance\)/, 'notice validates the original financial ledger balance');
has(recovery, /hold\.balanceAfter\.eq\(0\)/, 'notice validates that old spendable balance was secured at zero');
has(recovery, /valid\.length === 1 \? valid\[0\] : null/, 'spent/returned/used/ambiguous recovery is not advertised');
has(policy, /laterLedgerCount === 0/, 'any later ledger operation blocks recovery notice and payout');
has(recovery, /oldWalletZero: Boolean\(oldWallet\?\.balance\.eq\(0\)\)/, 'recovery requires the old wallet to remain at zero');
has(deletion, /if \(beforeReal\.gt\(0\)\)/, 'DEMO-only accounts do not create a REAL recovery record');
has(recovery, /changed\.count !== 1/, 'concurrent restoration loses the status compare-and-set and rolls back');
test(!/recoveryAvailable:\s*true/.test(verify), 'new user, DEMO-only user, or used recovery is not unconditionally advertised');

// Identity matching and exactly-once restoration.
has(recovery, /createHmac\("sha256"/, 'identity lookup uses HMAC-SHA256');
has(recovery, /DUELPLAY_ACCOUNT_RECOVERY_HMAC_SECRET/, 'persistent HMAC secret is required');
has(recovery, /Buffer\.byteLength\(secret, "utf8"\) < 32/, 'short secret fails closed');
has(recovery, /emailHmac, steamHmac, status: ACCOUNT_RECOVERY_AVAILABLE/, 'both email and Steam HMACs must match');
has(steam, /user\.emailVerifiedAt/, 'Steam recovery requires a confirmed email');
has(steam, /restoreAvailableRecovery\(tx,/, 'existing Steam-link transaction invokes recovery');
has(steam, /consumeLinkState\(expectedState, linkSession\.userId, linkSession\.id, ipAddress\)/, 'single-use OAuth state protection remains');
has(steam, /isBoundToSameSession\(linkSession\.userId, linkSession\.id, currentSession\.userId, currentSession\.id\)/, 'Steam callback remains bound to the same session');
has(recovery, /FOR UPDATE/, 'recovery row is locked against parallel callbacks');
has(recovery, /account-recovery:\$\{recovery\.id\}:credit/, 'restore credit has stable idempotency key');
has(recovery, /creditWallet\(tx, input\.userId, recovery\.realBalance/, 'restoration uses existing REAL ledger credit');
has(recovery, /updateMany\(\{ where: \{ id: recovery\.id, status: ACCOUNT_RECOVERY_AVAILABLE \}/, 'status is consumed atomically only once');
has(recovery, /if \(credited\.idempotent\) throw/, 'pre-existing credit causes rollback instead of double payment');
has(recovery, /ACCOUNT_BALANCE_RECOVERED/, 'successful restore is audited in the same transaction');
test(!/password|sessionToken|oauthState/i.test(schema.match(/model AccountRecovery \{([\s\S]*?)\n\}/)?.[1] ?? ''), 'recovery row stores no password, session token, or OAuth state');
has(schema, /emailHmac\s+String\s+@db\.Char\(64\)/, 'schema stores only email HMAC');
has(schema, /steamHmac\s+String\s+@db\.Char\(64\)/, 'schema stores only Steam HMAC');
has(migration, /CHECK \("realBalance" > 0\)/, 'database rejects zero or negative recovery amounts');
has(wallet, /ACCOUNT_DELETION_RECOVERY_CREDIT/, 'wallet ledger supports a dedicated recovery-credit type');
has(deletion, /realBalanceBefore: beforeReal\.toFixed\(4\)/, 'deletion audit records original REAL balance');
has(deletion, /demoBalanceBefore: beforeDemo\.toFixed\(4\)/, 'deletion audit records original DEMO balance');
has(deletion, /demoAnnulled: beforeDemo\.gt\(0\)/, 'deletion audit records DEMO annulment');
has(deletion, /realBalanceSecured: beforeReal\.toFixed\(4\)/, 'deletion audit records secured REAL amount');
has(audit, /Audit policy/, 'existing audit policy suite remains available');

console.log(`Account balance recovery policy + source-contract checks: PASS (${checks} assertions).`);
console.log('These are source-contract checks, not a live PostgreSQL transaction or end-to-end registration test.');
