/** Small pure helpers shared by the Steam-link routes and focused security tests. */
export function isSameOriginRequest(originHeader: string | null, expectedOrigin: string): boolean {
  if (!originHeader || originHeader === "null") return false;
  try {
    const supplied = new URL(originHeader);
    const expected = new URL(expectedOrigin);
    if ((supplied.protocol !== "https:" && supplied.protocol !== "http:") || supplied.username || supplied.password) return false;
    if (originHeader !== supplied.origin) return false;
    return supplied.origin === expected.origin;
  } catch {
    return false;
  }
}

export function isBoundToSameSession(
  issuedUserId: string,
  issuedSessionId: string,
  currentUserId: string,
  currentSessionId: string,
): boolean {
  return Boolean(issuedUserId && issuedSessionId && currentUserId && currentSessionId)
    && issuedUserId === currentUserId
    && issuedSessionId === currentSessionId;
}
