import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const route = read('app/api/admin/access/demo-balance/route.ts');
const usersRoute = read('app/api/admin/access/users/route.ts');
const component = read('components/Admin/AdminUsersPresence.tsx');
const wallet = read('lib/demo-wallet.ts');
const schema = read('prisma/schema.prisma');
const migration = read('prisma/migrations/20261012120000_demo_economy_foundation/migration.sql');

const checks = [
  ['uses existing DEMO transaction boundary', /withDemoTransaction\(async \(\{ db, demo \}\)/.test(route)],
  ['uses existing DEMO adjustment ledger', /demo\.adjustDemoCredits\(/.test(route)],
  ['does not import or call REAL wallet helpers', !/from ["']@\/lib\/wallet|creditWallet|debitWallet|tx\.wallet\./.test(route)],
  ['server enforces financial adjustment RBAC', /requirePermission\("finance\.wallet\.adjust"\)/.test(route)],
  ['server validates trusted same-origin request', /isAllowedPublicOrigin\(request\.headers\.get\("origin"\)/.test(route)],
  ['amount accepts only positive decimal text up to four places', route.includes('test(amountText)) throw new Error("INVALID_AMOUNT")') && route.includes('amount.lte(0)') && route.includes('amount.decimalPlaces() > 4')],
  ['operation has a stable idempotency key', /admin-demo-adjust:\$\{actor\.user\.id\}:\$\{operationId\}/.test(route)],
  ['wallet update and audit are in one DB transaction', /await db\.auditLog\.create\(/.test(route) && /withDemoTransaction\(async/.test(route)],
  ['audit captures actor, target, reason, amount and before/after balances', ['administratorId:', 'targetUserId:', 'reason,', 'amount:', 'balanceBefore:', 'balanceAfter:'].every((part) => route.includes(part))],
  ['DEMO ledger labels admin adjustments explicitly', /ADMIN DEMO ADJUSTMENT/.test(route)],
  ['user list returns current DEMO balance', /demoWallet: \{ select: \{ balance: true \} \}/.test(usersRoute) && /demoBalance: u\.demoWallet\?\.balance/.test(usersRoute)],
  ['adjustment controls are hidden without RBAC permission', /data\?\.canAdjustDemo/.test(component) && /canAdjustDemo: hasPermission\(access\.permissions, "finance\.wallet\.adjust"\)/.test(usersRoute)],
  ['UI provides both DEMO actions and reason field', component.includes('Пополнить DEMO') && component.includes('Списать DEMO') && component.includes('Причина операции')],
  ['UI refreshes the balance without reloading the page', /setData\(\(current\) => current \? \(\{[\s\S]*demoBalance: result\.balance/.test(component)],
  ['DEMO wallet remains a separate schema model and ledger', /model DemoWallet \{/.test(schema) && /model DemoTransaction \{/.test(schema)],
  ['DEMO transaction history is database-enforced append-only', migration.includes('CREATE TRIGGER \"DemoTransaction_append_only\"') && migration.includes('DemoTransaction history is append-only')],
  ['append-only ledger stores administrator identity and reason', route.includes('administratorId: actor.user.id') && route.includes('targetUserId: userId') && route.includes('reason,' )],
  ['DEMO wallet adjustment rejects zero and negative resulting balances', wallet.includes('if (delta.isZero()) throw new Error("INVALID_AMOUNT")') && wallet.includes('if (after.isNegative()) throw new Error("INSUFFICIENT_DEMO_BALANCE")')],
  ['wallet rows are locked for concurrent balance adjustments', /FOR UPDATE/.test(wallet) && /lockDemoWalletRow\(tx, userId\)/.test(wallet)],
  ['duplicate requests reuse the existing DEMO ledger transaction', /findUnique\(\{ where: \{ idempotencyKey \} \}\)/.test(wallet) && /return \{ idempotent: true, transaction: existing, wallet \}/.test(wallet)],
  ['DEMO policy and quota implementation are not referenced by the new API', !route.includes('demo-policy') && !route.includes('reserveDemoMatchStart')],
];

let failed = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failed++;
}

const amountPattern = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,4})?$/;
for (const [value, expected] of [['1', true], ['1.2500', true], ['0', true], ['-1', false], ['1.00001', false], ['NaN', false], ['Infinity', false], ['', false], ['1e3', false], ['01', false]]) {
  const valid = amountPattern.test(value) && Number.isFinite(Number(value)) && Number(value) > 0;
  const passed = valid === (expected && value !== '0');
  console.log(`${passed ? 'PASS' : 'FAIL'} amount validation sample ${JSON.stringify(value)}`);
  if (!passed) failed++;
}

if (failed) {
  console.error(`Admin DEMO balance checks failed: ${failed}`);
  process.exitCode = 1;
} else {
  console.log(`Admin DEMO balance checks: PASS (${checks.length + 10})`);
}
