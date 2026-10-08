import { prisma } from "@/lib/prisma";
import { getCurrentAdminSession } from "@/lib/admin-auth";

const ADMIN_MFA_MAX_AGE_MS = 8 * 60 * 60 * 1000;
function isFresh(verifiedAt: Date | null | undefined) { return Boolean(verifiedAt && Date.now() - verifiedAt.getTime() <= ADMIN_MFA_MAX_AGE_MS); }

export const ADMIN_ROLE_CODES = [
  "SUPERADMIN",
  "FINANCIAL_ADMIN",
  "ADMIN",
  "MODERATOR",
  "SUPPORT",
  "AUDITOR",
  "TECH_ADMIN",
  "CONTENT_ADMIN",
  "ANALYST",
  "SECURITY_ADMIN",
  "FOUNDER",
] as const;
export type AdminRoleCode = typeof ADMIN_ROLE_CODES[number];

export const ADMIN_ROLE_DEFINITIONS: Record<AdminRoleCode, {
  level: number;
  title: string;
  description: string;
  legacyAuthority: number;
  permissions: readonly string[];
}> = {
  SUPERADMIN: { level: 1, title: "SUPERADMIN", description: "Полный операционный контроль без права физического удаления неизменяемой финансовой истории.", legacyAuthority: 5, permissions: ["users.view","users.restrict","matches.view","matches.cancel","matches.investigate","disputes.view","disputes.resolve","evidence.view","evidence.manage","incidents.view","incidents.manage","finance.view","ledger.view","deposits.review","withdrawals.review","withdrawals.approve","withdrawals.reject","servers.view","servers.manage","content.manage","maps.manage","modes.manage","seasons.manage","notifications.send","support.view","support.tickets.reply","support.tickets.manage","reports.view","security.view","security.sessions.revoke_all","settings.manage","feature_flags.manage","admin.audit.view","admin.audit.write","roles.manage","roles.assign","staff.admin_invite","finance.wallet.adjust","finance.freeze","finance.reconciliation.view"] },
  FINANCIAL_ADMIN: { level: 2, title: "FINANCIAL ADMIN", description: "Финансы, ledger, депозиты, выводы, source of funds и сверка.", legacyAuthority: 3, permissions: ["users.view","matches.view","finance.view","ledger.view","deposits.review","withdrawals.review","withdrawals.approve","withdrawals.reject","finance.reconciliation.view","finance.source_of_funds.view","finance.freeze","reports.view","admin.audit.view","support.view","finance.wallet.adjust"] },
  ADMIN: { level: 3, title: "ADMIN", description: "Операционное управление пользователями, матчами, контентом и поддержкой.", legacyAuthority: 3, permissions: ["users.view","users.restrict","matches.view","matches.cancel","matches.investigate","disputes.view","disputes.resolve","evidence.view","evidence.manage","incidents.view","incidents.manage","content.manage","maps.manage","modes.manage","seasons.manage","notifications.send","support.view","support.tickets.reply","support.tickets.manage","reports.view","risk.cases.review"] },
  MODERATOR: { level: 4, title: "MODERATOR", description: "Модерация матчей, споров, доказательств, инцидентов и ограничений.", legacyAuthority: 2, permissions: ["users.view","users.restrict","matches.view","matches.cancel","matches.investigate","disputes.view","disputes.resolve","evidence.view","evidence.manage","incidents.view","incidents.manage","support.view","support.tickets.reply","reports.view","risk.cases.review"] },
  SUPPORT: { level: 5, title: "SUPPORT", description: "Поддержка игроков и просмотр необходимого контекста.", legacyAuthority: 1, permissions: ["users.view","matches.view","finance.view","deposits.review","withdrawals.review","support.view","support.tickets.reply","support.tickets.manage","disputes.view","reports.view"] },
  AUDITOR: { level: 6, title: "AUDITOR", description: "Только чтение и аудит пользователей, матчей, финансов и действий администраторов.", legacyAuthority: 3, permissions: ["users.view","matches.view","matches.investigate","disputes.view","evidence.view","incidents.view","finance.view","ledger.view","deposits.review","withdrawals.review","reports.view","support.view","admin.audit.view","security.view","finance.reconciliation.view"] },
  TECH_ADMIN: { level: 7, title: "TECH ADMIN", description: "Серверы, здоровье, технические логи, обслуживание и аварийные действия.", legacyAuthority: 5, permissions: ["servers.view","servers.manage","system.logs.view","system.maintenance","system.incidents.view","matches.view","admin.audit.view","security.view"] },
  CONTENT_ADMIN: { level: 8, title: "CONTENT ADMIN", description: "Карты, режимы, сезоны и публичный контент DuelPlay.", legacyAuthority: 5, permissions: ["content.manage","maps.manage","modes.manage","seasons.manage","notifications.send","content.skins.manage","content.avatars.manage","settings.content.manage","reports.view"] },
  ANALYST: { level: 9, title: "ANALYST", description: "Аналитика и отчеты без права изменения данных.", legacyAuthority: 3, permissions: ["reports.view","analytics.view","users.view","matches.view","finance.view","ledger.view","admin.audit.view"] },
  SECURITY_ADMIN: { level: 10, title: "SECURITY ADMIN", description: "Безопасность, сессии, MFA, подозрительная активность и security incidents.", legacyAuthority: 5, permissions: ["security.view","security.manage","security.sessions.revoke_all","security.sessions.revoke","security.mfa.manage","security.devices.view","security.login_history.view","incidents.view","incidents.manage","admin.audit.view","admin.audit.write","users.view"] },
  FOUNDER: { level: 999, title: "FOUNDER", description: "Специальная системная роль с полным доступом. Физическое удаление неизменяемой финансовой истории запрещено.", legacyAuthority: 5, permissions: ["*"] },
};

export const ADMIN_ACTION_PERMISSIONS: Record<string, string> = {
  resolveDispute: "disputes.resolve",
  revokeUserSessions: "security.sessions.revoke",
  revokeAllSessions: "security.sessions.revoke_all",
  platformSetting: "settings.manage",
  featureFlag: "feature_flags.manage",
  standardTheme: "settings.content.manage",
  backgroundTheme: "settings.content.manage",
  heroBackground: "settings.content.manage",
  sendNotification: "notifications.send",
  topSkinAdd: "content.skins.manage",
  topSkinDelete: "content.skins.manage",
  avatarPresetAdd: "content.avatars.manage",
  avatarPresetDelete: "content.avatars.manage",
  fraudReview: "risk.cases.review",
  userStatus: "users.restrict",
  userRole: "roles.assign",
  issueAdminInvite: "staff.admin_invite",
  walletAdjust: "finance.wallet.adjust",
  withdrawalStatus: "withdrawals.review",
  depositStatus: "deposits.review",
  supportReply: "support.tickets.reply",
  supportDelete: "support.tickets.delete",
  supportStatus: "support.tickets.manage",
  cancelMatch: "matches.cancel",
};

function isFounderUser(user: { steamId?: string | null; nickname?: string | null }) {
  const ownerSteam = process.env.DUELPLAY_OWNER_STEAM_ID?.trim();
  return Boolean((ownerSteam && user.steamId === ownerSteam) || user.nickname === "DuelPlayOwner");
}

function legacyRoleToCode(role: string): AdminRoleCode | null {
  if (role === "SUPERADMIN") return "SUPERADMIN";
  if (role === "ADMIN") return "ADMIN";
  if (role === "MODERATOR") return "MODERATOR";
  if (role === "SUPPORT") return "SUPPORT";
  return null;
}

export function rolePermissions(roleCode: AdminRoleCode): string[] {
  return [...ADMIN_ROLE_DEFINITIONS[roleCode].permissions];
}

export function hasPermission(permissions: readonly string[], permission: string) {
  return permissions.includes("*") || permissions.includes(permission);
}

export function effectivePermissions(roleCode: AdminRoleCode, overrides: unknown): string[] {
  const base = new Set(rolePermissions(roleCode));
  if (overrides && typeof overrides === "object" && !Array.isArray(overrides)) {
    const value = overrides as { allow?: unknown; deny?: unknown };
    if (Array.isArray(value.allow)) for (const p of value.allow) if (typeof p === "string") base.add(p);
    if (Array.isArray(value.deny) && !base.has("*")) for (const p of value.deny) if (typeof p === "string") base.delete(p);
  }
  return [...base];
}

export async function resolveAdminAccess(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, nickname: true, steamId: true, role: true, twoFactorEnabled: true, adminRoleAssignment: true } });
  if (!user) return null;
  if (isFounderUser(user)) return { user, roleCode: "FOUNDER" as AdminRoleCode, level: 999, legacyAuthority: 5, permissions: ["*"], assignment: user.adminRoleAssignment };
  const assigned = user.adminRoleAssignment;
  const roleCode = (assigned?.roleCode as AdminRoleCode | undefined) || legacyRoleToCode(user.role);
  if (!roleCode || !ADMIN_ROLE_DEFINITIONS[roleCode]) return { user, roleCode: null, level: 0, legacyAuthority: 0, permissions: [], assignment: assigned };
  const def = ADMIN_ROLE_DEFINITIONS[roleCode];
  return { user, roleCode, level: def.level, legacyAuthority: def.legacyAuthority, permissions: effectivePermissions(roleCode, assigned?.permissionOverrides), assignment: assigned };
}

export async function requirePermission(permission: string) {
  const session = await getCurrentAdminSession();
  if (!session?.user) throw new Error("ADMIN_LOGIN_REQUIRED");
  if (!session.user.twoFactorEnabled) throw new Error("ADMIN_MFA_SETUP_REQUIRED");
  if (!isFresh(session.adminMfaVerifiedAt)) throw new Error("ADMIN_MFA_REQUIRED");
  const access = await resolveAdminAccess(session.user.id);
  if (!access || access.level === 0) throw new Error("FORBIDDEN");
  if (!hasPermission(access.permissions, permission)) throw new Error("FORBIDDEN");
  return access;
}

export async function requirePermissionForUser(userId: string, permission: string) {
  const access = await resolveAdminAccess(userId);
  if (!access || access.level === 0 || !hasPermission(access.permissions, permission)) throw new Error("FORBIDDEN");
  return access;
}

export async function requireAnyPermission(permissions: readonly string[]) {
  const session = await getCurrentAdminSession();
  if (!session?.user) throw new Error("ADMIN_LOGIN_REQUIRED");
  if (!session.user.twoFactorEnabled) throw new Error("ADMIN_MFA_SETUP_REQUIRED");
  if (!isFresh(session.adminMfaVerifiedAt)) throw new Error("ADMIN_MFA_REQUIRED");
  const access = await resolveAdminAccess(session.user.id);
  if (!access || access.level === 0 || !permissions.some(p => hasPermission(access.permissions, p))) throw new Error("FORBIDDEN");
  return access;
}

export function permissionForAdminAction(action: string) {
  return ADMIN_ACTION_PERMISSIONS[action] || null;
}

export function adminLegacyAuthority(role: string) {
  if (role === "SUPERADMIN") return 5;
  if (role === "ADMIN") return 3;
  if (role === "MODERATOR") return 2;
  if (role === "SUPPORT") return 1;
  return 0;
}

export const isProtectedFounder = isFounderUser;
