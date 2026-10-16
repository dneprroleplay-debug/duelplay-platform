import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const root = process.cwd();
const rbacPath = path.join(root, "lib", "admin-rbac.ts");
const rbacSource = fs.readFileSync(rbacPath, "utf8");
const sourceFile = ts.createSourceFile(rbacPath, rbacSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const neededConstants = new Set([
  "ADMIN_ROLE_DEFINITIONS",
  "FINANCIAL_STATUS_MUTATION_PERMISSIONS",
  "ADMIN_ACTION_PERMISSIONS",
]);
const neededFunctions = new Set([
  "rolePermissions",
  "hasPermission",
  "effectivePermissions",
]);
const snippets = [];
for (const statement of sourceFile.statements) {
  if (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(d => neededConstants.has(d.name.getText(sourceFile)))) {
    snippets.push(statement.getText(sourceFile).replace(/^export\s+/, ""));
  } else if (ts.isFunctionDeclaration(statement) && neededFunctions.has(statement.name?.text)) {
    snippets.push(statement.getText(sourceFile).replace(/^export\s+/, ""));
  }
}
assert.equal(snippets.length, neededConstants.size + neededFunctions.size, "RBAC policy constants/functions must be found for executable tests");
snippets.push(`globalThis.policy = { rolePermissions, hasPermission, effectivePermissions, ADMIN_ROLE_DEFINITIONS, ADMIN_ACTION_PERMISSIONS };`);
const javascript = ts.transpile(snippets.join("\n\n"), { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None });
const sandbox = {};
vm.runInNewContext(javascript, sandbox, { filename: "admin-rbac-policy-under-test.js" });
const policy = sandbox.policy;
const rolePerms = (role) => policy.rolePermissions(role);

// 1. Theme / content settings permission is restored on SUPERADMIN and kept on CONTENT_ADMIN.
const superadmin = rolePerms("SUPERADMIN");
const contentAdmin = rolePerms("CONTENT_ADMIN");
assert.equal(policy.hasPermission(superadmin, "settings.content.manage"), true, "SUPERADMIN must be able to manage the standard theme, background theme and hero");
assert.equal(policy.hasPermission(contentAdmin, "settings.content.manage"), true, "CONTENT_ADMIN must keep settings.content.manage");
for (const action of ["standardTheme", "backgroundTheme", "heroBackground"]) {
  assert.equal(policy.ADMIN_ACTION_PERMISSIONS[action], "settings.content.manage", `${action} must still be gated by settings.content.manage`);
}
assert.equal(policy.hasPermission(policy.effectivePermissions("SUPERADMIN", null), "settings.content.manage"), true, "effective SUPERADMIN permissions include settings.content.manage");

// 2. Payout management and payout confirmation are split.
assert.equal(policy.hasPermission(superadmin, "creator.payouts.manage"), true, "SUPERADMIN keeps creator.payouts.manage");
assert.equal(policy.hasPermission(superadmin, "creator.payouts.pay"), true, "SUPERADMIN must be able to confirm payouts");
const financial = rolePerms("FINANCIAL_ADMIN");
assert.equal(policy.hasPermission(financial, "creator.payouts.manage"), true, "FINANCIAL_ADMIN keeps creator.payouts.manage");
assert.equal(policy.hasPermission(financial, "creator.payouts.pay"), false, "FINANCIAL_ADMIN must not receive creator.payouts.pay automatically");
assert.equal(policy.hasPermission(policy.effectivePermissions("FINANCIAL_ADMIN", null), "creator.payouts.pay"), false, "effective FINANCIAL_ADMIN permissions must not include creator.payouts.pay");

// 3. Founder keeps wildcard access to both permission groups.
const founderWildcard = policy.effectivePermissions("FOUNDER", null);
assert.equal(policy.hasPermission(founderWildcard, "*"), true, "Founder wildcard must be preserved");
assert.equal(policy.hasPermission(founderWildcard, "creator.payouts.pay"), true, "Founder wildcard grants creator.payouts.pay");
assert.equal(policy.hasPermission(founderWildcard, "creator.payouts.manage"), true, "Founder wildcard grants creator.payouts.manage");
assert.equal(policy.hasPermission(founderWildcard, "settings.content.manage"), true, "Founder wildcard grants settings.content.manage");
assert.equal(policy.hasPermission(policy.effectivePermissions("FOUNDER", { deny: ["creator.payouts.pay"] }), "creator.payouts.pay"), true, "Founder wildcard is not narrowed by overrides");

// 4. No ordinary role inherits payout confirmation automatically.
for (const role of ["FINANCIAL_ADMIN", "ADMIN", "MODERATOR", "SUPPORT", "AUDITOR", "TECH_ADMIN", "CONTENT_ADMIN", "ANALYST", "SECURITY_ADMIN"]) {
  assert.equal(policy.hasPermission(policy.rolePermissions(role), "creator.payouts.pay"), false, `${role} must not receive creator.payouts.pay by default`);
  assert.equal(policy.hasPermission(policy.effectivePermissions(role, null), "creator.payouts.pay"), false, `${role} effective permissions must not include creator.payouts.pay by default`);
}

// 5. Role assignment handler hardens self-assignment and inactive admin targets.
const adminRoute = fs.readFileSync(path.join(root, "app", "api", "admin", "route.ts"), "utf8");
const userRoleStart = adminRoute.indexOf('if(action==="userRole")');
assert.ok(userRoleStart > 0, "userRole handler must exist");
const userRoleEnd = adminRoute.indexOf('if(action==="issueAdminInvite")', userRoleStart);
const userRole = adminRoute.slice(userRoleStart, userRoleEnd);
assert.match(userRole, /if\(id===me\.id\)return NextResponse\.json\(\{error:"Нельзя изменять собственную роль"\},\{status:403\}\)/, "changing your own role must be rejected with HTTP 403");
assert.match(userRole, /const isAdminRole=adminLevel\(role\)>=1;\s*if\(isAdminRole&&target\.status!=="ACTIVE"\)/, "assigning an administrative role to a non-ACTIVE user must be blocked");
assert.match(userRole, /if\(protectedOwner\(target\)\)/, "Founder protection must remain in userRole");
assert.match(userRole, /passwordHash/, "admin invite / password handling must remain in userRole");
assert.match(userRole, /auditRequest\(request, me\.id,"CHANGE_USER_ROLE"/, "userRole must keep audit logging");
assert.ok(!/if\(!isAdminRole && target\.status!=="ACTIVE"\)/.test(userRole), "removing admin rights from an inactive user must not be blocked");

// 6. Server enforces creator.payouts.pay only for the PAID transition.
const payoutRoute = fs.readFileSync(path.join(root, "app", "api", "creator-payouts", "route.ts"), "utf8");
assert.match(payoutRoute, /const requiredPermission=status==='PAID'\?'creator\.payouts\.pay':'creator\.payouts\.manage'/, "PAID must require creator.payouts.pay while APPROVED/REJECTED require creator.payouts.manage");
assert.match(payoutRoute, /requirePermission\(requiredPermission\)/, "payout permission must be enforced through requirePermission");
assert.match(payoutRoute, /enforceRateLimit\(tx,me\.id,'CREATOR_PAYOUT_ADMIN_PATCH'/, "payout rate limit must be preserved");
assert.match(payoutRoute, /if\(current\.status==='PAID'\)throw new Error\('PAYOUT_FINALIZED'\)/, "finalized payout guard must be preserved");
assert.match(payoutRoute, /if\(status==='PAID'&&current\.status!=='APPROVED'\)throw new Error\('PAYOUT_NOT_APPROVED'\)/, "PAID transition must require the APPROVED state");
assert.match(payoutRoute, /audit\(me\.id,'CREATOR_PAYOUT_STATUS'/, "payout status changes must stay audited");
for (const code of ["PAYOUT_FINALIZED", "PAYOUT_NOT_APPROVED", "PAYOUT_INVALID_TRANSITION"]) {
  const idx = payoutRoute.indexOf(`error.message==='${code}'`);
  assert.ok(idx > -1, `${code} must map to a domain response instead of a generic 500`);
  assert.match(payoutRoute.slice(idx, idx + 220), /\{status:409\}/, `${code} must respond 409 for an invalid payout transition`);
}

// 7. UI shows Mark paid only with creator.payouts.pay, transitions with creator.payouts.manage.
const legacyPanel = fs.readFileSync(path.join(root, "components", "Admin", "LegacyAdminPanel.tsx"), "utf8");
assert.ok(legacyPanel.includes('can("creator.payouts.pay")&&x.status==="APPROVED"'), "Mark paid button must be gated by creator.payouts.pay");
assert.ok(legacyPanel.includes('creatorPayoutAction(x.id,"PAID")'), "Mark paid button action must remain wired to the payout endpoint");
assert.ok(legacyPanel.includes('can("creator.payouts.manage")&&x.status==="PENDING"'), "Approve/Reject controls must be gated by creator.payouts.manage");
assert.ok(!legacyPanel.includes('can("finance.view")&&x.status==="APPROVED"'), "Mark paid must not be gated by finance.view");

// 8. RBAC catalog exposes the new permission without weakening manage.
const accessPage = fs.readFileSync(path.join(root, "app", "admin", "access", "page.tsx"), "utf8");
assert.match(accessPage, /\["creator\.payouts\.pay",/, "RBAC catalog must document creator.payouts.pay");
assert.match(accessPage, /\["creator\.payouts\.manage",/, "RBAC catalog must document creator.payouts.manage");
assert.match(accessPage, /\["settings\.content\.manage",/, "RBAC catalog must document settings.content.manage");

// 9. creator.payouts.pay cannot be manufactured through assignment overrides.
const payoutConfirmation = "creator.payouts.pay";
assert.equal(policy.hasPermission(policy.effectivePermissions("FINANCIAL_ADMIN", null), payoutConfirmation), false, "FINANCIAL_ADMIN must not have payout confirmation by default");
assert.equal(policy.hasPermission(policy.effectivePermissions("FINANCIAL_ADMIN", { allow: [payoutConfirmation] }), payoutConfirmation), false, "FINANCIAL_ADMIN must not gain payout confirmation through allow");
assert.equal(policy.hasPermission(policy.effectivePermissions("FINANCIAL_ADMIN", { allow: ["*", payoutConfirmation] }), payoutConfirmation), false, "FINANCIAL_ADMIN must not gain payout confirmation through wildcard allow");
for (const role of ["ADMIN", "MODERATOR", "SUPPORT", "AUDITOR", "TECH_ADMIN", "CONTENT_ADMIN", "ANALYST", "SECURITY_ADMIN"]) {
  assert.equal(policy.hasPermission(policy.effectivePermissions(role, { allow: ["*", payoutConfirmation] }), payoutConfirmation), false, `${role} must not gain payout confirmation through overrides`);
}
assert.equal(policy.hasPermission(policy.effectivePermissions("SUPERADMIN", null), payoutConfirmation), true, "SUPERADMIN must retain payout confirmation");
assert.equal(policy.hasPermission(policy.effectivePermissions("SUPERADMIN", { allow: [payoutConfirmation] }), payoutConfirmation), true, "SUPERADMIN payout confirmation survives allow override");
assert.equal(policy.hasPermission(policy.effectivePermissions("FOUNDER", null), payoutConfirmation), true, "FOUNDER must retain payout confirmation");
assert.equal(policy.hasPermission(policy.effectivePermissions("FOUNDER", { deny: [payoutConfirmation] }), payoutConfirmation), true, "FOUNDER wildcard must not be narrowed by deny");
assert.equal(policy.hasPermission(policy.effectivePermissions("FINANCIAL_ADMIN", null), "creator.payouts.manage"), true, "FINANCIAL_ADMIN must keep creator.payouts.manage");
assert.equal(policy.hasPermission(policy.effectivePermissions("SUPERADMIN", null), "creator.payouts.manage"), true, "SUPERADMIN must keep creator.payouts.manage");

console.log("Admin RBAC regressions (themes, payout split, role-assignment hardening, Founder wildcard): PASS");
