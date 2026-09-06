import { NotificationStatus } from "@prisma/client";

export const NOTIFICATION_PAGE_LIMIT = 50;
export const NOTIFICATION_STATUSES = ["UNREAD", "READ", "ARCHIVED"] as const;

export function notificationPageLimit(value: string | null) {
  const parsed = Number(value || 20);
  if (!Number.isInteger(parsed)) return 20;
  return Math.min(Math.max(parsed, 1), NOTIFICATION_PAGE_LIMIT);
}

export function notificationCursor(value: string | null) {
  const cursor = String(value || "").trim();
  return cursor || undefined;
}

export function notificationStatus(value: unknown): NotificationStatus | null {
  const status = String(value || "").toUpperCase();
  return (NOTIFICATION_STATUSES as readonly string[]).includes(status) ? (status as NotificationStatus) : null;
}
