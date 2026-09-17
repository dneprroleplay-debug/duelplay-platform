import fs from 'node:fs';
import assert from 'node:assert/strict';

const root = process.cwd();
const schema = fs.readFileSync(`${root}/prisma/schema.prisma`, 'utf8');
const policy = fs.readFileSync(`${root}/lib/architecture-policy.ts`, 'utf8');

for (const model of ['User','Wallet','Match','PlayerStats','Event','AuditLog','Game','Transaction','MatchPlayerStat','GameServer','EventPass','EventMissionProgress','Season','DuelPass','FeatureFlag','PlatformSetting','WebhookEvent']) {
  assert.match(schema, new RegExp(`model ${model}\\s*\\{`), `${model} must exist in the canonical schema`);
}

for (const relation of [
  'wallet.*Wallet',
  'matchesAsPlayerOne.*Match',
  'matchesAsPlayerTwo.*Match',
  'playerStats.*PlayerStats',
  'matchStats.*MatchPlayerStat',
  'notifications.*Notification',
  'auditLogs.*AuditLog',
  'eventPasses.*EventPass',
  'eventMissionProgress.*EventMissionProgress',
]) assert.match(schema, new RegExp(relation, 's'), `User must retain ${relation}`);

for (const relation of [
  'user.*User.*relation.*fields:\\[userId\\].*references:\\[id\\]',
  'transactions.*Transaction',
  'deposits.*Deposit',
  'withdrawals.*Withdrawal',
]) assert.match(schema, new RegExp(relation, 's'), `Wallet relationship missing: ${relation}`);

for (const relation of [
  'game.*Game.*relation',
  'playerOne.*User.*PlayerOneMatches',
  'playerTwo.*User.*PlayerTwoMatches',
  'winner.*User.*WinnerMatches',
  'loser.*User.*LoserMatches',
  'playerStats.*MatchPlayerStat',
  'gameServer.*GameServer',
  'disputes.*Dispute',
  'reports.*Report',
]) assert.match(schema, new RegExp(relation, 's'), `Match relationship missing: ${relation}`);

for (const model of ['User','Wallet','Match','PlayerStats','Event','AuditLog']) assert.match(policy, new RegExp(model));


const sourceFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '.git'].includes(entry.name)) continue;
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) sourceFiles.push(full);
  }
}
walk(root);
const applicationFiles = sourceFiles.filter((file) => /\/(app|components|lib)\//.test(file) && !file.includes('/lib/generated/') && !file.endsWith('/lib/prisma.ts'));
for (const file of applicationFiles) {
  const content = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(content, /new\s+PrismaClient\s*\(/, `Application code must use the shared Prisma singleton: ${file}`);
}
assert.match(fs.readFileSync(`${root}/lib/prisma.ts`, 'utf8'), /globalForPrisma\.prisma \?\? new PrismaClient\(\)/, 'lib/prisma.ts must own the Prisma singleton');

for (const domain of ['identity','finance','gameplay','progression','events','administration']) {
  assert.match(policy, new RegExp(`${domain}\\s*:`), `${domain} domain must be registered in the architecture policy`);
}

console.log('Architecture policy: 27/27 PASS');
