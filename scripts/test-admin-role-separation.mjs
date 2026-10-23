import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const admin = read(path.join("app", "api", "admin", "route.ts"));
const rbac = read(path.join("lib", "admin-rbac.ts"));
const payout = read(path.join("app", "api", "creator-payouts", "route.ts"));
const layout = read(path.join("app", "admin", "operations", "layout.tsx"));
const legacy = read(path.join("components", "Admin", "LegacyAdminPanel.tsx"));
const accessPage = read(path.join("app", "admin", "access", "page.tsx"));
const commandCatalog = read(path.join("lib", "admin-commands.ts"));
const gameModeRoute = read(path.join("app", "api", "admin", "game-modes", "route.ts"));

function rolePermissionsSource(role) {
  const match = rbac.match(new RegExp(`\\n\\s*${role}:\\s*\\{[^}]*permissions:\\s*\\[([^\\]]*)\\]`));
  return match ? match[1] : "";
}
function roleHas(role, permission) {
  return rolePermissionsSource(role).includes(`"${permission}"`);
}
function actionMapsTo(action, permission) {
  return rbac.includes(`${action}: "${permission}"`);
}

const checks = [
  ["Operations route has server-side SUPERADMIN guard", layout.includes("requireAdmin(5)") && layout.includes('redirect("/admin")')],
  ["Platform settings API is permission-gated (SUPERADMIN-only)", read(path.join("app", "api", "platform-settings", "route.ts")).includes('requirePermission("settings.manage")') && !roleHas("TECH_ADMIN", "settings.manage") && !roleHas("CONTENT_ADMIN", "settings.manage")],
  ["Feature flags API is permission-gated (SUPERADMIN-only)", read(path.join("app", "api", "feature-flags", "route.ts")).includes('requirePermission("feature_flags.manage")') && !roleHas("TECH_ADMIN", "feature_flags.manage") && !roleHas("CONTENT_ADMIN", "feature_flags.manage")],
  ["Site settings mutation API is permission-gated", read(path.join("app", "api", "site-settings", "route.ts")).includes('requirePermission("settings.content.manage")')],
  [
    "Admin role changes are gated by roles.assign",
    actionMapsTo("userRole", "roles.assign") && admin.includes('if(action==="userRole")') && admin.includes("permissionForAdminAction") && admin.includes("requirePermission(requiredPermission)"),
  ],
  [
    "roles.assign is reserved for SUPERADMIN",
    roleHas("SUPERADMIN", "roles.assign") && !roleHas("FINANCIAL_ADMIN", "roles.assign") && !roleHas("ADMIN", "roles.assign") && !roleHas("MODERATOR", "roles.assign") && !roleHas("SUPPORT", "roles.assign"),
  ],
  ["Self role change is rejected with 403", admin.includes("if(id===me.id)") && admin.includes("Нельзя изменять собственную роль")],
  ["Owner/Founder protection remains in admin API", admin.includes("protectedOwner(target)") && rbac.includes("DuelPlayOwner")],
  [
    "Wallet adjustment is gated by finance.wallet.adjust",
    actionMapsTo("walletAdjust", "finance.wallet.adjust") && roleHas("SUPERADMIN", "finance.wallet.adjust") && roleHas("FINANCIAL_ADMIN", "finance.wallet.adjust") && !roleHas("ADMIN", "finance.wallet.adjust") && !roleHas("MODERATOR", "finance.wallet.adjust") && !roleHas("SUPPORT", "finance.wallet.adjust"),
  ],
  [
    "Theme controls require settings.content.manage and stay off lower roles",
    actionMapsTo("standardTheme", "settings.content.manage") && actionMapsTo("backgroundTheme", "settings.content.manage") && actionMapsTo("heroBackground", "settings.content.manage") && roleHas("SUPERADMIN", "settings.content.manage") && roleHas("CONTENT_ADMIN", "settings.content.manage") && !roleHas("ADMIN", "settings.content.manage") && !roleHas("FINANCIAL_ADMIN", "settings.content.manage") && !roleHas("SUPPORT", "settings.content.manage"),
  ],
  ["Financial dashboard totals require finance.view", admin.includes('const dashboard=can("finance.view")?fullDashboard:')],
  ["Private user fields are scoped by role instead of legacy level", admin.includes("const canSeeUserPrivate=") && !admin.includes("const level=access.legacyAuthority")],
  [
    "PAID confirmation is split from creator.payouts.manage",
    payout.includes("const requiredPermission=status==='PAID'?'creator.payouts.pay':'creator.payouts.manage'") && roleHas("SUPERADMIN", "creator.payouts.pay") && roleHas("SUPERADMIN", "creator.payouts.manage") && roleHas("FINANCIAL_ADMIN", "creator.payouts.manage") && !roleHas("FINANCIAL_ADMIN", "creator.payouts.pay"),
  ],
  [
    "Payout permission is checked before the financial mutation",
    payout.indexOf("requirePermission(requiredPermission)") > 0 && payout.indexOf("requirePermission(requiredPermission)") < payout.indexOf("tx.creatorPayout.update"),
  ],
  [
    "Payout denial maps to 403 and hides internal errors",
    payout.includes("if(error.message==='FORBIDDEN')return NextResponse.json({error:'Недостаточно прав'},{status:403});") && payout.includes("status:500"),
  ],
  [
    "Creator UI sections use permission gates",
    legacy.includes('can("creator.payouts.manage")&&x.status==="PENDING"') && legacy.includes('can("creator.payouts.pay")&&x.status==="APPROVED"') && !legacy.includes('can("finance.view")&&x.status==="APPROVED"'),
  ],
  [
    "RBAC catalog documents payout and theme permissions",
    commandCatalog.includes('["creator.payouts.pay",') && commandCatalog.includes('["creator.payouts.manage",') && commandCatalog.includes('["settings.content.manage",') && accessPage.includes("ADMIN_COMMAND_CATALOG"),
  ],
  [
    "Game mode config permission is granted only to SUPERADMIN; FOUNDER remains protected wildcard",
    roleHas("SUPERADMIN", "game_modes.configure") && !roleHas("ADMIN", "game_modes.configure") && !roleHas("CONTENT_ADMIN", "game_modes.configure") && !roleHas("TECH_ADMIN", "game_modes.configure") && rolePermissionsSource("FOUNDER").includes('"*"'),
  ],
  [
    "Game mode API reads and writes use a strict FOUNDER/SUPERADMIN role guard",
    rbac.includes('export function hasGameModeAdminRole(roleCode: unknown)') && rbac.includes('roleCode === "FOUNDER" || roleCode === "SUPERADMIN"') && rbac.includes('export async function requireGameModeAdmin()') && (gameModeRoute.match(/requireGameModeAdmin\(\)/g) || []).length >= 2,
  ],
  [
    "Game mode Control Center entry and panel are hidden from all other role codes",
    commandCatalog.includes('["game_modes.configure",') && legacy.includes('(d.me.role==="FOUNDER"||d.me.role==="SUPERADMIN")&&can("game_modes.configure")') && accessPage.includes('roleCode==="FOUNDER"||roleCode==="SUPERADMIN"'),
  ],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed++;
}
if (failed) process.exit(1);
console.log(`Admin role separation: ${checks.length}/${checks.length} PASS`);
