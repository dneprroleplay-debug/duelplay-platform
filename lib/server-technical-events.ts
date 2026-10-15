const SECRET_KEY = /(?:secret|token|password|passphrase|authorization|api.?key|private.?key|credential|\.env)/i;
const SECRET_VALUE = /\b(bearer\s+)[A-Za-z0-9._~+/-]+=*|\b((?:secret|token|password|passphrase|api[_-]?key)\s*[:=]\s*)[^\s,;]+/gi;

export function cleanTechnicalText(value: string, limit: number) {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").replace(SECRET_VALUE, (_match, bearer, key) => `${bearer || key || ""}[redacted]`).trim().slice(0, limit);
}

function cleanValue(value: unknown, depth: number): unknown {
  if (depth > 5) return "[truncated]";
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return cleanTechnicalText(value, 2000);
  if (Array.isArray(value)) return value.slice(0, 40).map(item => cleanValue(item, depth + 1));
  if (typeof value !== "object") return undefined;
  const entries = Object.entries(value as Record<string, unknown>).slice(0, 80);
  return Object.fromEntries(entries.filter(([key]) => !SECRET_KEY.test(key)).map(([key, item]) => [key.slice(0, 100), cleanValue(item, depth + 1)]).filter(([, item]) => item !== undefined));
}

export function cleanTechnicalDetails(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return cleanValue(value, 0) as Record<string, unknown>;
}

export function isTechnicalIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}
