import fs from 'node:fs';

const api = fs.readFileSync(new URL('../app/api/cases/route.ts', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../components/Cases/Cases.tsx', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../prisma/migrations/20260905235500_case_opening_idempotency_scope/migration.sql', import.meta.url), 'utf8');

const checks = [
  ['server scopes keys to user', api.includes('const idempotencyKey = `${user.id}:${clientKey}`')],
  ['server recovers an existing opening', api.includes('openingKey') && api.includes('found: true')],
  ['server rejects cross-case key reuse', api.includes('IDEMPOTENCY_KEY_REUSED')],
  ['server persists opening before inventory response', api.includes('tx.caseOpening.create') && api.includes('tx.inventoryItem.create')],
  ['ui persists the key in sessionStorage', ui.includes('duelplay:case-opening:v1') && ui.includes('sessionStorage.setItem')],
  ['ui reuses the same key after an error', ui.includes('openingKeyRef.current') && ui.includes('getOpeningKey')],
  ['ui can recover after reload', ui.includes('/api/cases?openingKey=') && ui.includes('setRecovering(true)')],
  ['database uniqueness is scoped by user', migration.includes('CREATE UNIQUE INDEX "CaseOpening_userId_idempotencyKey_key"')],
];
for (const [name, ok] of checks) {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}
