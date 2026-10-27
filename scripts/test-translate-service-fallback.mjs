import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const route = readFileSync(new URL('../app/api/translate/route.ts', import.meta.url), 'utf8');
const deepl = readFileSync(new URL('../lib/deepl.ts', import.meta.url), 'utf8');
let checks = 0;
function has(source, pattern, message) { assert.match(source, pattern, message); checks++; }
has(deepl, /catch \(error\) \{[\s\S]*?\[DeepL\] request failed; falling back to source text[\s\S]*?return result;/, 'DeepL network failures fall back instead of bubbling to 503');
has(deepl, /invalid provider response; falling back to source text/, 'invalid provider JSON falls back instead of bubbling to 503');
has(deepl, /provider returned non-success status/, 'provider HTTP failures are logged with status');
has(route, /error\.message === "RATE_LIMITED"[\s\S]*?status: 429/, 'intentional rate limit is HTTP 429 rather than misleading 503');
has(route, /translation rate-limit persistence failed/, 'database/rate-limiter failures have a distinct diagnostic');
has(route, /translation request failed after rate-limit check/, 'other unexpected failures have a distinct diagnostic');
has(route, /Translation service temporarily unavailable[\s\S]*?status: 503/, '503 remains for actual rate-limit persistence/unexpected server failures');
console.log(`Translation API source-contract checks: PASS (${checks} assertions).`);
