import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const schema = read('prisma/schema.prisma');
const wallet = read('lib/wallet.ts');
const finance = read('lib/finance.ts');
const gateway = read('lib/payment-gateway.ts');
const walletRoute = read('app/api/wallet/transactions/route.ts');
const revenueRoute = read('app/api/admin/revenue/route.ts');
const paymentWebhook = read('app/api/payments/webhook/[provider]/route.ts');
const webhook = read('app/api/webhooks/[provider]/route.ts');

for (const model of ['Wallet', 'Transaction', 'WalletHold', 'Deposit', 'Withdrawal', 'KycVerification', 'PaymentReconciliation', 'PlatformLedgerEntry', 'WebhookEvent']) {
  assert.match(schema, new RegExp(`model ${model}\\s*\\{`), `${model} missing`);
}
for (const enumValue of ['WITHDRAWAL_RESERVE', 'WITHDRAWAL_RELEASE', 'WITHDRAWAL_COMPLETED', 'MATCH_STAKE_LOCK', 'MATCH_STAKE_RELEASE']) {
  assert.match(schema, new RegExp(`\\b${enumValue}\\b`), `${enumValue} missing from TransactionType`);
}
for (const enumValue of ['MATCH_STAKE', 'WITHDRAWAL']) assert.match(schema, new RegExp(`\\b${enumValue}\\b`), `Hold type ${enumValue} missing`);
assert.match(schema, /currency\s+String\s+@default\("USD"\)\s+@db\.Char\(3\)/);
assert.match(schema, /balance\s+Decimal\s+@db\.Decimal\(20, 4\)\s+@default\(0\.0000\)/);
assert.match(schema, /@@unique\(\[provider, externalId\]\)/);
assert.doesNotMatch(schema, /externalId\s+String\?/,'Webhook externalId must be required for compound uniqueness');

assert.match(wallet, /FOR UPDATE/);
assert.match(wallet, /new Prisma\.Decimal/);
assert.match(wallet, /walletHold\.create/);
assert.match(wallet, /releaseWalletHold/);
assert.doesNotMatch(wallet, /Number\(wallet\.balance\)/, 'Wallet arithmetic must not convert DB money to JS Number');
assert.doesNotMatch(wallet, /lockedBalance:\s*\{\s*(increment|decrement)/, 'Wallet service must assign Decimal lockedBalance after a row lock');

assert.match(finance, /PlatformLedgerType/);
assert.match(finance, /platformLedgerEntry\.create/);
assert.match(finance, /MANUAL_ADJUSTMENT/);
assert.match(finance, /allowNegative/);
assert.match(gateway, /PaymentGatewayAdapter/);
assert.match(gateway, /adapters: Partial/);
assert.match(gateway, /Production code must never treat environment flags alone as a working gateway/);
assert.match(walletRoute, /PAYMENT_GATEWAY_NOT_CONFIGURED/);
assert.match(walletRoute, /KYC_REQUIRED/);
assert.match(walletRoute, /DAILY_WITHDRAWAL_LIMIT/);
assert.match(walletRoute, /lockWallet\(/);
assert.match(walletRoute, /MANUAL_REVIEW/);
assert.match(revenueRoute, /platformLedgerEntry\.findMany/);
assert.match(revenueRoute, /MATCH_COMMISSION/);
assert.match(paymentWebhook, /provider_externalId/);
assert.match(paymentWebhook, /releaseWalletHold/);
assert.match(paymentWebhook, /withdrawal-refund:/);
assert.match(webhook, /provider_externalId/);
assert.match(webhook, /webhookEvent\.create/);

const sourceFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '.git'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) sourceFiles.push(full);
  }
}
walk(root);
for (const file of sourceFiles) {
  const rel = path.relative(root, file).replaceAll(path.sep, '/');
  if (rel === 'app/api/admin/route.ts' || rel === 'lib/wallet.ts') continue;
  const content = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(content, /lockedBalance\s*:\s*\{\s*(increment|decrement)/, `Direct lockedBalance arithmetic remains in ${rel}`);
}

const adminRoute = fs.readFileSync(path.join(root, 'app', 'api', 'admin', 'route.ts'), 'utf8');
assert.match(adminRoute, /releaseWalletHold\(tx,wallet\.userId,amount/,'admin withdrawal settlement must close the exact withdrawal hold');
console.log('Finance architecture: PASS');
console.log('Wallet/Ledger/Holds/Payments/KYC/Webhook/PlatformLedger checks: PASS');
console.log('Admin withdrawal settlement uses WalletHold lifecycle: PASS');
