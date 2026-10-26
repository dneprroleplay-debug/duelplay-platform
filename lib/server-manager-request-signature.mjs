import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

function signatureFor(secret, timestamp, nonce, method, path, body) {
  const bodyHash = createHmac('sha256', secret).update(body).digest('hex');
  const canonical = `${timestamp}\n${nonce}\n${method.toUpperCase()}\n${path}\n${bodyHash}`;
  return createHmac('sha256', secret).update(canonical).digest('hex');
}

export function createServerManagerRequestHeaders({ secret, method, path, body = '', now = Date.now(), nonce = randomBytes(16).toString('hex') }) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('SERVER_MANAGER_SECRET_INVALID');
  const timestamp = String(Math.floor(now / 1000));
  return {
    'x-duelplay-server-secret': secret,
    'x-duelplay-request-timestamp': timestamp,
    'x-duelplay-request-nonce': nonce,
    'x-duelplay-request-signature': signatureFor(secret, timestamp, nonce, method, path, body),
  };
}

export function verifyServerManagerRequestSignature({ secret, timestamp, nonce, signature, method, path, body = '', now = Date.now(), maxClockSkewSeconds = 90 }) {
  if (typeof secret !== 'string' || secret.length < 32) return false;
  if (!/^\d{10}$/.test(String(timestamp ?? '')) || !/^[a-f0-9]{32}$/i.test(String(nonce ?? '')) || !/^[a-f0-9]{64}$/i.test(String(signature ?? ''))) return false;
  if (Math.abs(Math.floor(now / 1000) - Number(timestamp)) > maxClockSkewSeconds) return false;
  const expected = signatureFor(secret, String(timestamp), String(nonce), method, path, body);
  const actualBytes = Buffer.from(String(signature), 'hex');
  const expectedBytes = Buffer.from(expected, 'hex');
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}
