import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.ts';

const root = process.cwd();
const schema = fs.readFileSync(`${root}/prisma/schema.prisma`, 'utf8');
const migration = fs.readFileSync(`${root}/prisma/migrations/20261012120000_demo_economy_foundation/migration.sql`, 'utf8');
const enumMigration = fs.readFileSync(`${root}/prisma/migrations/20261013090000_add_demo_dispute_enum_values/migration.sql`, 'utf8');
const lifecycleMigration = fs.readFileSync(`${root}/prisma/migrations/20261013100000_demo_dispute_accounting_lifecycle/migration.sql`, 'utf8');
const serviceSource = fs.readFileSync(`${root}/lib/demo-wallet.ts`, 'utf8');
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@/lib/prisma') return nextResolve(new URL('../lib/prisma.ts', import.meta.url).href, context);
    return nextResolve(specifier, context);
  },
});
const {
  DEMO_STARTER_CREDITS,
  getOrCreateDemoWallet,
  grantDemoStarterCredits,
  creditDemoCredits,
  adjustDemoCredits,
  reserveDemoStake,
  closeDemoWalletHold,
  recordDemoMatchFee,
  withDemoTransaction,
} = await import(pathToFileURL(`${root}/lib/demo-wallet.ts`));

// This adapter deliberately supports sequential business-rule tests only. It
// does not model PostgreSQL transactions, row locks, rollback, or concurrency.
function memoryAdapter() {
  const wallets = new Map();
  const transactions = new Map();
  const holdsByKey = new Map();
  const holdsByWalletMatch = new Map();
  const matchWrites = [];
  const matchModes = new Map();
  let failNextCreateMany = false;
  let failNextWalletInsert = false;
  let nextId = 1;
  const walletKey = (walletId, matchId) => `${walletId}:${matchId}`;

  const db = {
    wallets,
    transactions,
    holdsByKey,
    matchWrites,
    setMatchMode(id, mode) { matchModes.set(id, mode); },
    failFeeInsert() { failNextCreateMany = true; },
    failWalletInsert() { failNextWalletInsert = true; },
    match: {
      async findUnique({ where }) { return { economyMode: matchModes.get(where.id) ?? 'DEMO' }; },
      async create({ data }) { matchWrites.push(data); return { id: `match-${nextId++}`, ...data }; },
    },
    demoWallet: {
      async findUnique({ where }) { return wallets.get(where.userId) ?? null; },
      async update({ where, data }) {
        const row = [...wallets.values()].find(wallet => wallet.id === where.id);
        assert.ok(row, 'wallet must exist');
        Object.assign(row, data);
        return row;
      },
    },
    demoTransaction: {
      async findUnique({ where }) { return transactions.get(where.idempotencyKey) ?? null; },
      async findFirst({ where }) { return transactions.get(where.idempotencyKey) ?? null; },
      async create({ data }) {
        if (transactions.has(data.idempotencyKey)) throw new Error('UNIQUE_IDEMPOTENCY');
        const row = { id: `transaction-${nextId++}`, ...data };
        transactions.set(row.idempotencyKey, row);
        return row;
      },
      async createMany({ data, skipDuplicates }) {
        assert.equal(skipDuplicates, true);
        if (failNextCreateMany) {
          failNextCreateMany = false;
          throw new Error('DB_FAILURE');
        }
        let count = 0;
        for (const item of data) {
          if (transactions.has(item.idempotencyKey)) continue;
          const row = { id: `transaction-${nextId++}`, ...item };
          transactions.set(row.idempotencyKey, row);
          count++;
        }
        return { count };
      },
    },
    demoWalletHold: {
      async findUnique({ where }) { return holdsByKey.get(where.idempotencyKey) ?? null; },
      async findFirst({ where }) { return holdsByWalletMatch.get(walletKey(where.walletId, where.matchId)) ?? null; },
      async create({ data }) {
        if (holdsByKey.has(data.idempotencyKey) || holdsByWalletMatch.has(walletKey(data.walletId, data.matchId))) throw new Error('UNIQUE_HOLD');
        const row = { id: `hold-${nextId++}`, closedAt: null, ...data };
        holdsByKey.set(row.idempotencyKey, row);
        holdsByWalletMatch.set(walletKey(row.walletId, row.matchId), row);
        return row;
      },
      async updateMany({ where, data }) {
        const row = [...holdsByKey.values()].find(hold => hold.id === where.id);
        if (!row || row.status !== where.status || !row.amount.eq(where.amount)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    async $executeRaw(strings, userId) {
      assert.match(strings.join("?"), /ON CONFLICT \("userId"\) DO NOTHING/);
      if (failNextWalletInsert) {
        failNextWalletInsert = false;
        throw new Error('UNRELATED_DEMO_WALLET_DB_ERROR');
      }
      if (!wallets.has(userId)) {
        wallets.set(userId, {
          id: `wallet-${nextId++}`,
          userId,
          balance: new Prisma.Decimal('0.0000'),
          lockedBalance: new Prisma.Decimal('0.0000'),
          debtBalance: new Prisma.Decimal('0.0000'),
        });
        return 1;
      }
      return 0;
    },
    async $queryRaw(_strings, userId) {
      const wallet = wallets.get(userId);
      return wallet ? [{ ...wallet }] : [];
    },
  };
  return db;
}

const db = memoryAdapter();
const originalTransaction = prisma.$transaction;
let transactionCalls = 0;
prisma.$transaction = async callback => {
  transactionCalls++;
  return callback(db);
};

try {
  const emptyWallet = await getOrCreateDemoWallet('user-1');
  assert.equal(emptyWallet.balance.toString(), '0');
  assert.equal(db.transactions.size, 0, 'creating a wallet alone must not grant credits');
  db.failWalletInsert();
  await assert.rejects(() => getOrCreateDemoWallet('user-db-error'), /UNRELATED_DEMO_WALLET_DB_ERROR/);
  assert.equal(db.wallets.has('user-db-error'), false, 'unrelated wallet insert errors must propagate');
  console.log('PASS: wallet creation propagates unrelated database errors');

  const grant1 = await grantDemoStarterCredits('user-1');
  const grant2 = await grantDemoStarterCredits('user-1');
  assert.equal(DEMO_STARTER_CREDITS.toString(), '10000');
  assert.equal(grant1.idempotent, false);
  assert.equal(grant2.idempotent, true);
  assert.equal(db.wallets.get('user-1').balance.toString(), '10000');
  assert.equal([...db.transactions.values()].filter(row => row.type === 'STARTER_GRANT').length, 1);
  await assert.rejects(() => reserveDemoStake('user-1', 'match-float', 0.1, 'float-key', 'hold:float'), /INVALID_AMOUNT/);
  console.log('PASS: one-time starter grant, sequential idempotency, and number rejection');

  const stake = await reserveDemoStake('user-1', 'match-1', '1250.2500', 'stake:user-1:match-1', 'hold:user-1:match-1');
  const repeatedStake = await reserveDemoStake('user-1', 'match-1', '1250.2500', 'stake:user-1:match-1', 'hold:user-1:match-1');
  assert.equal(stake.idempotent, false);
  assert.equal(repeatedStake.idempotent, true);
  assert.equal(db.wallets.get('user-1').balance.toString(), '8749.75');
  await assert.rejects(() => reserveDemoStake('user-1', 'match-2', '9000', 'stake:user-1:match-2', 'hold:user-1:match-2'), /INSUFFICIENT_DEMO_BALANCE/);
  assert.equal(db.wallets.get('user-1').balance.toString(), '8749.75');
  await assert.rejects(() => reserveDemoStake('user-1', 'match-3', '1', '  ', 'hold:user-1:match-3'), /IDEMPOTENCY_REQUIRED/);
  console.log('PASS: sequential stake reserve idempotency, insufficient balance, Decimal validation, and key validation');

  const reserved = await reserveDemoStake('user-1', 'match-4', '500', 'stake:user-1:match-4', 'hold:user-1:match-4');
  assert.equal(reserved.hold.hold.status, 'ACTIVE');
  assert.equal(db.wallets.get('user-1').balance.toString(), '8249.75');
  assert.equal(db.wallets.get('user-1').lockedBalance.toString(), '1750.25');
  const refunded = await closeDemoWalletHold('user-1', 'match-4', '500', 'refund:user-1:match-4', 'RELEASED');
  const repeatedRefund = await closeDemoWalletHold('user-1', 'match-4', '500', 'refund:user-1:match-4', 'RELEASED');
  assert.equal(refunded.idempotent, false);
  assert.equal(repeatedRefund.idempotent, true);
  assert.equal(db.wallets.get('user-1').balance.toString(), '8749.75');
  assert.equal(db.wallets.get('user-1').lockedBalance.toString(), '1250.25');
  assert.equal(db.holdsByKey.get('hold:user-1:match-4').status, 'RELEASED');
  await assert.rejects(
    () => reserveDemoStake('user-1', 'match-4', '500', 'stake:user-1:match-4', 'hold:user-1:match-4'),
    /DEMO_HOLD_ALREADY_CLOSED/,
  );
  console.log('PASS: sequential stake reserve/refund idempotency and closed-hold reuse rejection');

  const consumedStake = await reserveDemoStake('user-1', 'match-5', '750', 'stake:user-1:match-5', 'hold:user-1:match-5');
  assert.equal(consumedStake.hold.hold.status, 'ACTIVE');
  const consumed = await closeDemoWalletHold('user-1', 'match-5', '750', 'consume:user-1:match-5', 'CONSUMED');
  const repeatedConsume = await closeDemoWalletHold('user-1', 'match-5', '750', 'consume:user-1:match-5', 'CONSUMED');
  assert.equal(consumed.idempotent, false);
  assert.equal(repeatedConsume.idempotent, true);
  assert.equal(db.wallets.get('user-1').lockedBalance.toString(), '1250.25');
  assert.equal(db.holdsByKey.get('hold:user-1:match-5').status, 'CONSUMED');

  await withDemoTransaction(({ demo }) => demo.creditDemoCredits('user-1', '123.4500', 'win:user-1:match-5', 'MATCH_WIN', 'match-5'));
  const adjustment = await adjustDemoCredits('user-1', '-23.4500', 'adjust:user-1:1', 'Test correction');
  const repeatedAdjustment = await adjustDemoCredits('user-1', '-23.4500', 'adjust:user-1:1', 'Test correction');
  assert.equal(adjustment.idempotent, false);
  assert.equal(repeatedAdjustment.idempotent, true);
  assert.equal(db.wallets.get('user-1').balance.toString(), '8099.75');
  console.log('PASS: consume, win credit, and signed adjustment are sequentially idempotent');

  const fee1 = await recordDemoMatchFee('match-5', '25', 'demo:fee:match-5');
  const fee2 = await recordDemoMatchFee('match-5', '25', 'demo:fee:match-5');
  assert.equal(fee1.idempotent, false);
  assert.equal(fee2.idempotent, true);
  assert.equal(fee1.transaction.walletId, null);
  assert.equal(db.wallets.get('user-1').balance.toString(), '8099.75');
  await assert.rejects(() => recordDemoMatchFee('match-other', '25', 'demo:fee:match-5'), /IDEMPOTENCY_CONFLICT/);
  db.failFeeInsert();
  await assert.rejects(() => recordDemoMatchFee('match-6', '10', 'demo:fee:match-6'), /DB_FAILURE/);
  console.log('PASS: sequential virtual fee idempotency and parameter conflict');

  db.setMatchMode('real-match', 'REAL');
  await assert.rejects(
    () => reserveDemoStake('user-1', 'real-match', '1', 'stake:real-match', 'hold:real-match'),
    /REAL_MATCH_FORBIDDEN/,
  );
  console.log('PASS: DEMO wallet operations reject a REAL match reference');

  let capturedOperations;
  await withDemoTransaction(async ({ db: transactionDb, demo }) => {
    capturedOperations = demo;
    await assert.rejects(() => grantDemoStarterCredits('user-2'), /NESTED_DEMO_TRANSACTION_NOT_ALLOWED/);
    await transactionDb.match.create({ data: { economyMode: 'DEMO' } });
    const scopedWallet = await demo.getOrCreateDemoWallet('user-2');
    assert.equal(scopedWallet.balance.toString(), '0');
    await demo.grantDemoStarterCredits('user-2');
  });
  assert.equal(db.matchWrites.length, 1, 'the composition callback exposes a single transaction context for Match and DEMO writes');
  await assert.rejects(() => capturedOperations.getOrCreateDemoWallet('user-3'), /DEMO_TRANSACTION_SCOPE_CLOSED/);
  assert.ok(transactionCalls >= 12, 'public standalone operations must open their own Prisma transaction');
  console.log('PASS: composition facade scope and nested independent transaction guard');
} finally {
  prisma.$transaction = originalTransaction;
}

assert.match(schema, /enum MatchEconomyMode\s*\{\s*REAL\s+DEMO\s*\}/);
assert.match(schema, /economyMode\s+MatchEconomyMode\s+@default\(REAL\)/);
assert.match(schema, /model DemoWallet\s*\{[\s\S]*?balance\s+Decimal[\s\S]*?lockedBalance\s+Decimal[\s\S]*?user\s+User[\s\S]*?@@unique\(\[id, userId\]\)/);
assert.match(schema, /debtBalance\s+Decimal\s+@default\(0\.0000\)/);
assert.match(schema, /model DemoTransaction\s*\{[\s\S]*?balanceAfter\s+Decimal\?[\s\S]*?idempotencyKey\s+String\s+@unique/);
assert.match(schema, /model DemoWalletHold\s*\{[\s\S]*?@@unique\(\[walletId, matchId\]\)/);
assert.match(migration, /ADD COLUMN "economyMode" "MatchEconomyMode" NOT NULL DEFAULT 'REAL'/);
assert.match(migration, /CREATE TRIGGER "Match_economyMode_immutable"/);
assert.match(migration, /CREATE TRIGGER "DemoTransaction_append_only"/);
assert.match(migration, /CREATE TRIGGER "DemoWalletHold_no_reopen"/);
assert.match(migration, /OLD\."status" <> 'ACTIVE' OR NEW\."status" = 'ACTIVE'/);
assert.match(migration, /CREATE TRIGGER "DemoTransaction_demo_match_only"/);
assert.match(migration, /CREATE TRIGGER "DemoWalletHold_demo_match_only"/);
assert.match(migration, /DemoTransaction_one_starter_grant_per_user_key[\s\S]*?WHERE "type" = 'STARTER_GRANT'/);
assert.match(migration, /DemoTransaction_idempotencyKey_nonempty[\s\S]*?regexp_replace\("idempotencyKey"/);
assert.match(migration, /DemoWalletHold_idempotencyKey_nonempty[\s\S]*?regexp_replace\("idempotencyKey"/);
assert.match(lifecycleMigration, /ADD COLUMN "debtBalance" DECIMAL\(20,4\) NOT NULL DEFAULT 0\.0000/);
for (const enumValue of ['MATCH_FEE_ADJUSTMENT', 'DISPUTE_ADJUSTMENT', 'DEBT_ADJUSTMENT']) {
  assert.match(enumMigration, new RegExp(`ADD VALUE IF NOT EXISTS '${enumValue}'`), `${enumValue} must be added by the earlier enum migration`);
  assert.match(lifecycleMigration, new RegExp(`"type" = '${enumValue}'`), `${enumValue} must be used by the Stage 4 lifecycle constraints`);
  assert.doesNotMatch(lifecycleMigration, new RegExp(`ADD VALUE IF NOT EXISTS '${enumValue}'`), `${enumValue} must not be re-added in Stage 4`);
}
assert.match(serviceSource, /resolveDemoDisputeInTransaction/);
assert.match(serviceSource, /DEMO virtual debt repaid from incoming credits/);
assert.match(serviceSource, /demo:dispute:\$\{disputeId\}:reverse:/);
for (const realTable of ['Wallet', 'Transaction', 'WalletHold', 'Deposit', 'Withdrawal']) {
  assert.doesNotMatch(migration, new RegExp(`(?:ALTER TABLE|CREATE TABLE) "${realTable}"`));
}
assert.doesNotMatch(serviceSource, /from ["']@\/lib\/wallet["']|\b(?:creditWallet|debitWallet|lockWallet|releaseWalletHold)\s*\(/);
assert.doesNotMatch(migration, /DROP\s+(?:TABLE|COLUMN|INDEX|TYPE)/i);
console.log('PASS: schema/SQL static contracts, immutability, append-only, closed holds, and REAL finance isolation');
console.log('NOTE: this script validates sequential business behavior only; rollback, row locks, and concurrency require isolated PostgreSQL');
