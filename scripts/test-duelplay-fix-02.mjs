import fs from 'node:fs';

const page = fs.readFileSync('app/matches/[id]/page.tsx', 'utf8');
const admin = fs.readFileSync('app/api/admin/route.ts', 'utf8');
const lifecycle = fs.readFileSync('lib/match-lifecycle.ts', 'utf8');
const header = fs.readFileSync('components/Header/Header.tsx', 'utf8');
const timers = fs.readFileSync('lib/match-timers.ts', 'utf8');

const checks = [
  [
    'creator does not receive already-in-duel button',
    page.includes('participant&&user?.id!==m.playerOneId&&<div className="mt-5 flex justify-center">') &&
      !page.includes('{participant&&<div className="mt-5 flex justify-center">'),
  ],
  [
    'admin wallet target UUID is explicitly cast',
    admin.includes('WHERE id=${target.wallet.id}::uuid FOR UPDATE'),
  ],
  [
    'admin wallet owner UUID is explicitly cast',
    admin.includes('WHERE id=${owner.wallet.id}::uuid FOR UPDATE'),
  ],
  [
    'admin credit can be repeated with a fresh idempotency key',
    admin.includes('const adjustmentKey=`admin-credit:${id}:${Date.now()}:${Math.random().toString(36).slice(2)}`'),
  ],
  [
    'admin debit can be repeated with a fresh idempotency key',
    admin.includes('const adjustmentKey=`admin-adjust:${id}:${Date.now()}:${Math.random().toString(36).slice(2)}`'),
  ],
  [
    '10-minute no-connection timeout creates a cancellation notification',
    lifecycle.includes('cancelMatchWithRefund(m.id, "No player connected within 10 minutes")'),
  ],
  [
    '10-minute cancellation notification has a visible specific body',
    header.includes('Никто не подключился к серверу CS2 за 10 минут. Ставка возвращена.'),
  ],
  [
    'connection timeout remains 10 minutes by default',
    timers.includes('MATCH_CONNECTION_TIMEOUT_MS = positiveMs("DUELPLAY_CONNECTION_TIMEOUT_MS", 10 * 60 * 1000)'),
  ],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
if (failed.length) process.exit(1);
console.log(`\nAll ${checks.length} focused DuelPlay fix checks passed.`);
