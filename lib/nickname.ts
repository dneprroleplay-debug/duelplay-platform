export function normalizeNickname(value: string) {
  return value.trim().toLowerCase();
}

export function validateNickname(value: string) {
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 20) return false;
  return /^[a-zA-Z0-9_]+$/.test(trimmed);
}
