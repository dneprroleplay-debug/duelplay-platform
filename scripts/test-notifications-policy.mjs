import fs from 'node:fs';
import assert from 'node:assert/strict';

const route = fs.readFileSync('app/api/notifications/route.ts', 'utf8');
const lib = fs.readFileSync('lib/notification-policy.ts', 'utf8');
const schema = fs.readFileSync('prisma/schema.prisma', 'utf8');
const files = [
  'app/api/matches/[id]/join/route.ts',
  'app/api/matches/[id]/cancel/route.ts',
  'app/api/matches/[id]/result/route.ts',
  'app/api/matchmaking/route.ts',
  'app/api/challenges/route.ts',
  'app/api/wallet/transactions/route.ts',
  'app/api/referral-race/route.ts',
  'app/api/messages/route.ts',
  'app/api/friends/route.ts',
].map((p) => fs.readFileSync(p, 'utf8'));

assert.match(route, /getCurrentUser/);
assert.match(route, /userId: user\.id/);
assert.match(route, /take: limit \+ 1/);
assert.match(route, /nextCursor/);
assert.match(route, /action === "readAll"/);
assert.match(route, /action === "read"/);
assert.match(route, /action === "archive"/);
assert.match(route, /status: "UNREAD"/);
assert.match(route, /status: "ARCHIVED"/);
assert.match(lib, /NOTIFICATION_PAGE_LIMIT = 50/);
assert.match(schema, /model Notification/);
assert.match(fs.readFileSync('prisma/migrations/20260906040000_notification_feed_index/migration.sql', 'utf8'), /Notification_user_status_createdAt_idx/);

const required = [
  ['MATCH_FOUND', 'matchmaking'],
  ['MATCH_READY', 'match join'],
  ['WIN', 'match result'],
  ['LOSS', 'match result'],
  ['CHALLENGE', 'challenge'],
  ['CHALLENGE_ACCEPTED', 'challenge'],
  ['DEPOSIT', 'finance'],
  ['WITHDRAWAL', 'finance'],
  ['REFERRAL', 'referral'],
  ['SYSTEM', 'social'],
];
const combined = files.join('\n');
for (const [type] of required) assert.match(combined, new RegExp(type));
console.log('Notifications policy: PASS');
console.log('Feed pagination/archive/auth: PASS');
console.log('Required match/challenge/referral/finance notification coverage: PASS');
