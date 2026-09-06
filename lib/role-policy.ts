import { adminLevel } from "@/lib/admin";

export const USER_ROLES = ["USER", "SUPPORT", "MODERATOR", "ADMIN", "SUPERADMIN"] as const;
export type UserRole = typeof USER_ROLES[number];

export const STAFF_ROLES = ["SUPPORT", "MODERATOR", "ADMIN", "SUPERADMIN"] as const;
export const MODERATION_ROLES = ["MODERATOR", "ADMIN", "SUPERADMIN"] as const;

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && (USER_ROLES as readonly string[]).includes(value);
}

export function hasAdminLevel(role: unknown, minimum: number) {
  return typeof role === "string" && adminLevel(role) >= minimum;
}

export function isStaffRole(role: unknown) {
  return typeof role === "string" && (STAFF_ROLES as readonly string[]).includes(role);
}

export function isModeratorRole(role: unknown) {
  return typeof role === "string" && (MODERATION_ROLES as readonly string[]).includes(role);
}

export function canAssignRole(actorRole: unknown, targetRole: unknown) {
  if (actorRole !== "SUPERADMIN" || !isUserRole(targetRole)) return false;
  return true;
}
