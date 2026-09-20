import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const PERIOD_SECONDS = 30;

export function generateTotpSecret(): string {
  const bytes = randomBytes(20);
  let bits = 0;
  let buffer = 0;
  let out = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(buffer >>> bits) & 31];
      buffer &= bits > 0 ? (1 << bits) - 1 : 0;
    }
  }
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

function base32Decode(value: string): Buffer {
  const normalized = value.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  if (!normalized || /[^A-Z2-7]/.test(normalized)) throw new Error("INVALID_TOTP_SECRET");
  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const char of normalized) {
    buffer = (buffer << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
      buffer &= bits > 0 ? (1 << bits) - 1 : 0;
    }
  }
  return Buffer.from(bytes);
}

function codeForCounter(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const payload = Buffer.alloc(8);
  payload.writeBigInt64BE(BigInt(counter));
  const digest = createHmac("sha1", key).update(payload).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(binary % 1_000_000).padStart(6, "0");
}

export function verifyTotp(secret: string, input: string, window = 1): boolean {
  const code = input.trim();
  if (!/^\d{6}$/.test(code)) return false;
  const now = Math.floor(Date.now() / 1000 / PERIOD_SECONDS);
  const expected: string[] = [];
  for (let offset = -window; offset <= window; offset += 1) expected.push(codeForCounter(secret, now + offset));
  const supplied = Buffer.from(code);
  return expected.some(candidate => {
    const actual = Buffer.from(candidate);
    return supplied.length === actual.length && timingSafeEqual(supplied, actual);
  });
}

export function buildOtpAuthUri(secret: string, account: string): string {
  const issuer = "DuelPlay";
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${PERIOD_SECONDS}`;
}
