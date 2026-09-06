import { Prisma } from "@prisma/client";

/**
 * Transaction-scoped abuse limiter.
 * The advisory lock closes the check-then-insert race where concurrent requests
 * could all observe the same counter before any of them wrote a SecurityEvent.
 */
export async function enforceRateLimit(
  tx: Prisma.TransactionClient,
  userId: string,
  eventType: string,
  limit: number,
  windowMs = 60_000,
) {
  if (!userId || !eventType || !Number.isInteger(limit) || limit < 1 || !Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error("INVALID_RATE_LIMIT");
  }

  const since = new Date(Date.now() - windowMs);

  // PostgreSQL advisory locks are released automatically when this transaction ends.
  // Hashing the user + event keeps unrelated users/events independent.
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${`${userId}:${eventType}`}, 0))
  `;

  const count = await tx.securityEvent.count({
    where: { userId, eventType, createdAt: { gte: since } },
  });

  if (count >= limit) throw new Error("RATE_LIMITED");

  await tx.securityEvent.create({
    data: {
      userId,
      eventType,
      severity: "INFO",
      ipAddress: "application",
      metadata: { windowMs, limit },
    },
  });
}

export function isRateLimitError(error: unknown) {
  return error instanceof Error && error.message === "RATE_LIMITED";
}
