import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const MAX_EVENTS = 200;
const MAX_BYTES = 256 * 1024;
const MAX_ATTEMPTS = 5;
const SENSITIVE = /(?:secret|token|password|passphrase|authorization|api.?key|private.?key|credential|\.env)/i;
const scrub = value => String(value).replace(/\b(bearer\s+)[A-Za-z0-9._~+/-]+=*|\b((?:secret|token|password|passphrase|api[_-]?key)\s*[:=]\s*)[^\s,;]+/gi, (_m, bearer, key) => `${bearer || key || ''}[redacted]`).slice(0, 2000);
function clean(value, depth = 0) {
  if (depth > 4) return '[truncated]';
  if (typeof value === 'string') return scrub(value);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 30).map(item => clean(item, depth + 1));
  if (!value || typeof value !== 'object') return undefined;
  return Object.fromEntries(Object.entries(value).slice(0, 50).filter(([key]) => !SENSITIVE.test(key)).map(([key, item]) => [key.slice(0, 80), clean(item, depth + 1)]).filter(([, item]) => item !== undefined));
}

export function createTechnicalEventOutbox({ apiUrl, secret, serverId, filePath, deadLetterFile = `${filePath}.dead-letter.json`, fetchImpl = fetch, onDrop = () => {} }) {
  const file = filePath;
  const diagnosticsFile = `${file}.diagnostics.json`;
  let flushing = Promise.resolve();

  function load() {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      return Array.isArray(parsed) ? parsed.filter(row => row && typeof row === 'object').slice(-MAX_EVENTS) : [];
    } catch { return []; }
  }

  function save(queue) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, JSON.stringify(queue), { mode: 0o600 });
    renameSync(temporary, file);
  }

  function saveDeadLetter(entry) {
    try {
      mkdirSync(dirname(deadLetterFile), { recursive: true, mode: 0o700 });
      let rows = [];
      try { const parsed = JSON.parse(readFileSync(deadLetterFile, 'utf8')); if (Array.isArray(parsed)) rows = parsed; } catch {}
      rows.push(entry);
      const beforeTrim = rows.length;
      rows = rows.slice(-100);
      while (rows.length && Buffer.byteLength(JSON.stringify(rows), 'utf8') > 128 * 1024) rows.shift();
      const temporary = `${deadLetterFile}.tmp`;
      writeFileSync(temporary, JSON.stringify(rows), { mode: 0o600 });
      renameSync(temporary, deadLetterFile);
      return { saved: true, evicted: beforeTrim - rows.length };
    } catch { return { saved: false, evicted: 0 }; }
  }

  function readDiagnostics() {
    try {
      const value = JSON.parse(readFileSync(diagnosticsFile, 'utf8'));
      return { lostEvents: Number.isSafeInteger(value.lostEvents) ? value.lostEvents : 0, outboxOverflows: Number.isSafeInteger(value.outboxOverflows) ? value.outboxOverflows : 0, deadLetterEvictions: Number.isSafeInteger(value.deadLetterEvictions) ? value.deadLetterEvictions : 0, lastLossAt: value.lastLossAt ?? null, lastLossReason: value.lastLossReason ?? null, lastLostEventId: value.lastLostEventId ?? null };
    } catch { return { lostEvents: 0, outboxOverflows: 0, deadLetterEvictions: 0, lastLossAt: null, lastLossReason: null, lastLostEventId: null }; }
  }

  function recordLoss({ eventId = null, reason, deadLetterSaved = false, deadLetterEvictions = 0 }) {
    const previous = readDiagnostics();
    const diagnostics = {
      lostEvents: Math.min(Number.MAX_SAFE_INTEGER, previous.lostEvents + 1),
      outboxOverflows: Math.min(Number.MAX_SAFE_INTEGER, previous.outboxOverflows + (reason.startsWith('OUTBOX_OVERFLOW') ? 1 : 0)),
      deadLetterEvictions: Math.min(Number.MAX_SAFE_INTEGER, previous.deadLetterEvictions + deadLetterEvictions),
      lastLossAt: new Date().toISOString(), lastLossReason: reason, lastLostEventId: eventId,
    };
    try {
      mkdirSync(dirname(diagnosticsFile), { recursive: true, mode: 0o700 });
      const temporary = `${diagnosticsFile}.tmp`;
      writeFileSync(temporary, JSON.stringify(diagnostics), { mode: 0o600 });
      renameSync(temporary, diagnosticsFile);
    } catch {}
    try { onDrop({ eventId, serverId, reason, deadLetterSaved, deadLetterEvictions, diagnostics }); } catch {}
  }

  function deadLetterLoss(entry, reason) {
    const result = saveDeadLetter({ event: entry.event, attempts: Number(entry.attempts || 0), failedAt: new Date().toISOString(), reason });
    recordLoss({ eventId: entry.event?.eventId ?? null, reason, deadLetterSaved: result.saved });
    if (result.evicted) recordLoss({ eventId: entry.event?.eventId ?? null, reason: 'DEAD_LETTER_OVERFLOW', deadLetterSaved: result.saved, deadLetterEvictions: result.evicted });
    return result;
  }

  async function flushQueue() {
    const queue = load();
    while (queue.length) {
      const entry = queue[0];
      try {
        const response = await fetchImpl(`${apiUrl.replace(/\/$/, '')}/api/server-manager/events`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-duelplay-server-secret': secret },
          body: JSON.stringify(entry.event),
          signal: AbortSignal.timeout(3000),
        });
        if (!response.ok) throw new Error(`HTTP_${response.status}`);
        queue.shift();
        save(queue);
      } catch (error) {
        entry.attempts = Number(entry.attempts || 0) + 1;
        if (entry.attempts >= MAX_ATTEMPTS) {
          queue.shift();
          const reason = /^HTTP_\d+$/.test(error?.message || '') ? error.message : error?.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK_ERROR';
          deadLetterLoss(entry, reason);
        }
        save(queue);
        break;
      }
    }
  }

  function flush() {
    flushing = flushing.then(flushQueue, flushQueue).catch(() => {});
    return flushing;
  }

  async function emit({ source, category, severity = 'INFO', message, details, correlationId, matchId, result, occurredAt = new Date().toISOString() }) {
    const queue = load();
    const event = { eventId: randomUUID(), serverId, source: scrub(source).slice(0, 64), category: scrub(category).slice(0, 64), severity, message: scrub(message).slice(0, 500), details: clean(details), correlationId: correlationId ? scrub(correlationId).slice(0, 128) : null, matchId, result: result ? scrub(result).slice(0, 64) : null, occurredAt };
    queue.push({ attempts: 0, event });
    let bounded = queue;
    const dropped = [];
    while (bounded.length > MAX_EVENTS || (bounded.length && Buffer.byteLength(JSON.stringify(bounded), 'utf8') > MAX_BYTES)) dropped.push(bounded.shift());
    try { save(bounded); } catch { return false; }
    for (const entry of dropped) {
      const result = saveDeadLetter({ event: entry.event, attempts: Number(entry.attempts || 0), failedAt: new Date().toISOString(), reason: 'OUTBOX_OVERFLOW' });
      recordLoss({ eventId: entry.event?.eventId ?? null, reason: result.saved ? 'OUTBOX_OVERFLOW' : 'OUTBOX_OVERFLOW_DEAD_LETTER_WRITE_FAILED', deadLetterSaved: result.saved, deadLetterEvictions: result.evicted });
      if (result.evicted) recordLoss({ eventId: entry.event?.eventId ?? null, reason: 'DEAD_LETTER_OVERFLOW', deadLetterSaved: result.saved, deadLetterEvictions: result.evicted });
    }
    if (!bounded.some(entry => entry.event?.eventId === event.eventId)) return false;
    await flush();
    return true;
  }

  return { emit, flush, readDiagnostics };
}
