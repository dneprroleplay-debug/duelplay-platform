import fs from 'node:fs';
const schema=fs.readFileSync('prisma/schema.prisma','utf8');
const route=fs.readFileSync('app/api/webhooks/[provider]/route.ts','utf8');
const checks=[
  ['WebhookEvent model', /model WebhookEvent\s*\{/.test(schema)],
  ['provider allowlist', /PROVIDERS\s*=\s*new Set/.test(route)],
  ['provider secret validation', /Provider not configured/.test(route)],
  ['HMAC SHA-256', /createHmac\("sha256"/.test(route)],
  ['timing-safe signature compare', /timingSafeEqual/.test(route)],
  ['raw-body signature', /update\(raw,\s*"utf8"\)/.test(route)],
  ['payload size guard', /MAX_PAYLOAD_BYTES/.test(route) && /413/.test(route)],
  ['JSON validation', /Invalid JSON/.test(route) && /Invalid payload/.test(route)],
  ['event id extraction', /x-event-id/.test(route) && /event_id/.test(route)],
  ['idempotency lookup', /findUnique\(\{ where: \{ externalId \} \}\)/.test(route)],
  ['persisted RECEIVED state', /status:\s*"RECEIVED"/.test(route)],
  ['concurrent duplicate protection', /P2002/.test(route)],
];
let failed=0;for(const [name,ok] of checks){console.log(`${ok?'PASS':'FAIL'} ${name}`);if(!ok)failed++;}
if(failed)process.exit(1);console.log(`Webhook policy PASS: ${checks.length}/${checks.length}`);
