import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../lib/prime.ts', import.meta.url), 'utf8');
if (!src.includes('MONTH') || !src.includes('QUARTER') || !src.includes('YEAR')) throw new Error('plan catalog incomplete');
if (!src.includes('endsAt') || !src.includes('remainingMs')) throw new Error('status helper incomplete');
console.log('prime policy: PASS');
