/**
 * Shared rendering helpers for match-related notifications.
 *
 * The bell (Header) and the notifications page must show the same factual
 * information for a cancelled match: the real cancellation text, the name of
 * the administrator (or system) that cancelled it and the exact cancellation
 * time. Both surfaces therefore use this single formatter.
 */
export type NotificationPayload = Record<string, unknown> | null | undefined;

const BY_LABEL = {
  RU: "Отменил",
  UA: "Скасував",
  EN: "Cancelled by",
  PL: "Anulował",
} as const;

const AT_LABEL = {
  RU: "Время отмены",
  UA: "Час скасування",
  EN: "Cancelled at",
  PL: "Czas anulowania",
} as const;

export function notificationMatchId(payload: NotificationPayload): string | null {
  const matchId = payload?.matchId;
  if (!matchId) return null;
  const value = String(matchId);
  return value.length ? value : null;
}

/**
 * Returns the factual cancellation details (reason, actor, time) or an empty
 * string when the notification is not a cancellation.
 */
export function cancellationDetail(language: string, payload: NotificationPayload): string {
  if (!payload) return "";
  const locale = (language in BY_LABEL ? language : "EN") as keyof typeof BY_LABEL;
  const parts: string[] = [];
  const reason = String(payload.reason ?? "").trim();
  const cancelledBy = String(payload.cancelledBy ?? "").trim();
  const cancelledAt = String(payload.cancelledAt ?? "").trim();
  if (reason) parts.push(reason);
  if (cancelledBy) parts.push(`${BY_LABEL[locale]}: ${cancelledBy}`);
  if (cancelledAt) {
    const parsed = new Date(cancelledAt);
    const stamp = Number.isNaN(parsed.getTime()) ? cancelledAt : parsed.toLocaleString();
    parts.push(`${AT_LABEL[locale]}: ${stamp}`);
  }
  return parts.join(" · ");
}
