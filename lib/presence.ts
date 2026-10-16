export const PRESENCE_THRESHOLD_MS = 120_000; // 120 seconds unified inactivity threshold

export function getPresenceCutoff(now = new Date()): Date {
  return new Date(now.getTime() - PRESENCE_THRESHOLD_MS);
}

export function isSessionOnline(
  session: { isRevoked: boolean; expiresAt: Date; lastActiveAt: Date },
  now = new Date()
): boolean {
  if (session.isRevoked) return false;
  if (session.expiresAt.getTime() <= now.getTime()) return false;
  return session.lastActiveAt.getTime() >= now.getTime() - PRESENCE_THRESHOLD_MS;
}
