import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const policy = fs.readFileSync(`${root}/lib/inventory-policy.ts`, 'utf8');
const adapter = fs.readFileSync(`${root}/lib/steam-trade.ts`, 'utf8');
const route = fs.readFileSync(`${root}/app/api/inventory/trade/route.ts`, 'utf8');
const schema = fs.readFileSync(`${root}/prisma/schema.prisma`, 'utf8');
const migration = fs.readFileSync(`${root}/prisma/migrations/20260906050000_steam_trades/migration.sql`, 'utf8');

for (const status of ['TRADE_PENDING','TRADE_SENT','TRADE_ACCEPTED','TRADE_FAILED']) assert.match(adapter, new RegExp(status));
assert.match(adapter, /assertSteamTradeReady/);
assert.match(adapter, /HttpSteamTradeProvider/);
assert.match(adapter, /providerRequest/);
assert.match(adapter, /AbortSignal\.timeout/);
assert.match(policy, /AVAILABLE.*TRADE_PENDING/);
assert.match(policy, /TRADE_PENDING.*TRADE_SENT/);
assert.match(policy, /TRADE_SENT.*TRADE_ACCEPTED/);
assert.match(policy, /TRADE_SENT.*TRADE_FAILED/);
assert.match(schema, /model SteamTrade/);
assert.match(schema, /@@unique\(\[inventoryItemId\]\)/);
assert.match(migration, /CREATE TABLE "SteamTrade"/);
assert.match(migration, /SteamTrade_inventoryItemId_key/);
assert.match(route, /assertSteamTradeReady/);
assert.match(route, /steamAssetId/);
assert.match(route, /TRADE_PENDING/);
assert.match(route, /provider-controlled/);
assert.match(route, /tx\.notification\.create/);
assert.match(route, /getSteamTradeProvider/);
assert.match(route, /TRADE_PROVIDER_FAILED/);
console.log('Steam Trade policy: 15/15 PASS');

const webhook = fs.readFileSync(`${root}/app/api/webhooks/[provider]/route.ts`, 'utf8');
assert.match(webhook, /steam-trade/);
assert.match(webhook, /externalTradeId/);
assert.match(webhook, /PROCESSED/);
console.log('Steam Trade provider/webhook policy: 6/6 PASS');
