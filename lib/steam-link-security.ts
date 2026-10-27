/** Small pure helpers shared by the Steam-link routes and focused security tests. */
export function isSameOriginRequest(originHeader: string | null, expectedOrigin: string): boolean {
  if (!originHeader) return false;
  try {
    return new URL(originHeader).origin === new URL(expectedOrigin).origin;
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
