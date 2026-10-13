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
  "FINANCIAL_STATUS_PERMISSIONS",
  "FINANCIAL_STATUS_MUTATION_PERMISSIONS",
]);
const neededFunctions = new Set([
  "rolePermissions",
  "hasPermission",
  "effectivePermissions",
  "financialStatusPermission",
  "canTransitionDepositStatus",
  "canTransitionWithdrawalStatus",
  "assertFinancialStatusUpdateSucceeded",
]);
const snippets = [];
for (const statement of sourceFile.statements) {
  if (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(d => neededConstants.has(d.name.getText(sourceFile)))) {
    snippets.push(statement.getText(sourceFile).replace(/^export\s+/, ""));
  } else if (ts.isFunctionDeclaration(statement) && neededFunctions.has(statement.name?.text)) {
    snippets.push(statement.getText(sourceFile).replace(/^export\s+/, ""));
  }
}
assert.equal(snippets.length, neededConstants.size + neededFunctions.size, "RBAC policy functions/constants must be found for executable tests");
snippets.push(`globalThis.policy = { effectivePermissions, hasPermission, financialStatusPermission, canTransitionDepositStatus, canTransitionWithdrawalStatus, assertFinancialStatusUpdateSucceeded };`);
const javascript = ts.transpile(snippets.join("\n\n"), { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None });
const sandbox = {};
vm.runInNewContext(javascript, sandbox, { filename: "admin-rbac-policy-under-test.js" });
const policy = sandbox.policy;

const allSeven = [
  "deposits.review", "deposits.approve", "deposits.reject",
  "withdrawals.review", "withdrawals.approve", "withdrawals.complete", "withdrawals.reject",
];
const mutations = ["deposits.approve", "deposits.reject", "withdrawals.approve", "withdrawals.complete", "withdrawals.reject"];

for (const role of ["FINANCIAL_ADMIN", "SUPERADMIN"]) {
  const permissions = policy.effectivePermissions(role, null);
  for (const permission of allSeven) assert.equal(policy.hasPermission(permissions, permission), true, `${role} must have ${permission}`);
}
assert.equal(policy.hasPermission(policy.effectivePermissions("FOUNDER", null), "deposits.approve"), true, "protected Founder wildcard remains intact");
assert.equal(policy.hasPermission(policy.effectivePermissions("FOUNDER", { deny: allSeven }), "withdrawals.complete"), true, "protected Founder wildcard is not narrowed by assignment overrides");
assert.equal(policy.hasPermission(policy.effectivePermissions("FINANCIAL_ADMIN", { deny: ["deposits.approve"] }), "deposits.approve"), false, "explicit deny revokes a FINANCIAL_ADMIN permission");
assert.equal(policy.hasPermission(policy.effectivePermissions("SUPERADMIN", { deny: ["withdrawals.complete"] }), "withdrawals.complete"), false, "explicit deny revokes a SUPERADMIN permission");

for (const role of ["SUPPORT", "AUDITOR"]) {
  const defaults = policy.effectivePermissions(role, null);
  assert.equal(policy.hasPermission(defaults, "deposits.review"), true, `${role} retains deposit review by default`);
  assert.equal(policy.hasPermission(defaults, "withdrawals.review"), true, `${role} retains withdrawal review by default`);
  const allowOverrides = policy.effectivePermissions(role, { allow: mutations });
  const wildcardOverrides = policy.effectivePermissions(role, { allow: ["*", ...mutations] });
  for (const permission of mutations) {
    assert.equal(policy.hasPermission(allowOverrides, permission), false, `${role} cannot gain ${permission} through allow`);
    assert.equal(policy.hasPermission(wildcardOverrides, permission), false, `${role} cannot gain ${permission} through wildcard allow`);
  }
  assert.equal(policy.hasPermission(wildcardOverrides, "random.permission"), false, `${role} cannot gain wildcard access through overrides`);
  assert.equal(policy.hasPermission(policy.effectivePermissions(role, { deny: ["deposits.review"] }), "deposits.review"), false, `${role} explicit deny revokes deposit review`);
  assert.equal(policy.hasPermission(policy.effectivePermissions(role, { deny: ["withdrawals.review"] }), "withdrawals.review"), false, `${role} explicit deny revokes withdrawal review`);
}

for (const role of ["ADMIN", "MODERATOR", "TECH_ADMIN", "CONTENT_ADMIN", "ANALYST", "SECURITY_ADMIN"]) {
  const ordinary = policy.effectivePermissions(role, { allow: ["*", ...allSeven] });
  for (const permission of allSeven) assert.equal(policy.hasPermission(ordinary, permission), false, `${role} must not inherit ${permission} in this permission group`);
}

const expectedTargets = {
  depositStatus: { PROCESSING: "deposits.approve", COMPLETED: "deposits.approve", FAILED: "deposits.reject", EXPIRED: "deposits.reject" },
  withdrawalStatus: { PROCESSING: "withdrawals.approve", COMPLETED: "withdrawals.complete", FAILED: "withdrawals.reject", REJECTED: "withdrawals.reject" },
};
for (const [action, statuses] of Object.entries(expectedTargets)) {
  for (const [status, permission] of Object.entries(statuses)) assert.equal(policy.financialStatusPermission(action, status), permission);
  assert.equal(policy.financialStatusPermission(action, "PENDING"), null, `${action} must reject unsupported target status`);
  assert.equal(policy.financialStatusPermission(action, "NOT_A_STATUS"), null, `${action} must reject unknown target status`);
}
assert.equal(policy.canTransitionDepositStatus("PENDING", "COMPLETED"), true);
assert.equal(policy.canTransitionDepositStatus("PROCESSING", "FAILED"), true);
assert.equal(policy.canTransitionDepositStatus("FAILED", "COMPLETED"), true, "legacy deposit logic permits retrying failed deposit settlement");
assert.equal(policy.canTransitionDepositStatus("EXPIRED", "COMPLETED"), true, "legacy deposit logic permits retrying expired deposit settlement");
assert.equal(policy.canTransitionDepositStatus("COMPLETED", "COMPLETED"), true, "same terminal state is idempotent");
assert.equal(policy.canTransitionDepositStatus("COMPLETED", "FAILED"), false, "terminal deposit cannot change state");
assert.equal(policy.canTransitionDepositStatus("UNKNOWN", "COMPLETED"), false);
assert.equal(policy.canTransitionWithdrawalStatus("PENDING", "PROCESSING"), true);
assert.equal(policy.canTransitionWithdrawalStatus("PENDING", "COMPLETED"), false, "pending withdrawal cannot be completed directly");
assert.equal(policy.canTransitionWithdrawalStatus("MANUAL_REVIEW", "REJECTED"), true);
assert.equal(policy.canTransitionWithdrawalStatus("MANUAL_REVIEW", "COMPLETED"), false, "manual-review withdrawal must be processed before completion");
assert.equal(policy.canTransitionWithdrawalStatus("PROCESSING", "COMPLETED"), true);
assert.equal(policy.canTransitionWithdrawalStatus("COMPLETED", "COMPLETED"), true, "same terminal state is idempotent");
assert.equal(policy.canTransitionWithdrawalStatus("COMPLETED", "REJECTED"), false, "terminal withdrawal cannot change state");
assert.equal(policy.canTransitionWithdrawalStatus("REJECTED", "COMPLETED"), false);
assert.equal(policy.canTransitionWithdrawalStatus("UNKNOWN", "COMPLETED"), false);

let financialSideEffects = 0;
assert.throws(() => {
  policy.assertFinancialStatusUpdateSucceeded(0);
  financialSideEffects += 1;
}, /FINANCIAL_STATUS_CONFLICT/);
assert.equal(financialSideEffects, 0, "failed conditional update must throw before any financial side effect");
assert.doesNotThrow(() => policy.assertFinancialStatusUpdateSucceeded(1));

const route = fs.readFileSync(path.join(root, "app", "api", "admin", "route.ts"), "utf8");
const authAt = route.indexOf("requirePermission(requiredPermission)");
const withdrawalBranchAt = route.indexOf('if(action==="withdrawalStatus")');
const depositBranchAt = route.indexOf('if(action==="depositStatus")');
assert.ok(authAt > 0 && authAt < withdrawalBranchAt && authAt < depositBranchAt, "status permission must be checked before either financial transaction");
assert.match(route, /canTransitionWithdrawalStatus\(w\.status,status\).*INVALID_WITHDRAWAL_TRANSITION/);
assert.match(route, /canTransitionDepositStatus\(d\.status,status\).*INVALID_DEPOSIT_TRANSITION/);
assert.match(route, /tx\.withdrawal\.updateMany\(\{where:\{id,status:w\.status\}/, "withdrawal update must compare-and-set the status read in the transaction");
assert.match(route, /tx\.deposit\.updateMany\(\{where:\{id,status:d\.status\}/, "deposit update must compare-and-set the status read in the transaction");
assert.match(route, /assertFinancialStatusUpdateSucceeded\(transition\.count\)/, "lost compare-and-set must abort with a controlled conflict");
const withdrawalCasAt = route.indexOf("tx.withdrawal.updateMany({where:{id,status:w.status}");
const withdrawalEffectsAt = route.indexOf("creditWallet(tx,wallet.userId,amount,`withdraw-refund:", withdrawalCasAt);
const withdrawalHoldAt = route.indexOf("releaseWalletHold(tx,wallet.userId,amount,`withdrawal-close:", withdrawalCasAt);
const depositCasAt = route.indexOf("tx.deposit.updateMany({where:{id,status:d.status}");
const depositCreditAt = route.indexOf("creditWallet(tx,owner.userId,Number(d.amount)", depositCasAt);
assert.ok(withdrawalCasAt > 0 && withdrawalEffectsAt > withdrawalCasAt && withdrawalHoldAt > withdrawalCasAt, "withdrawal wallet effects must follow successful compare-and-set");
assert.ok(depositCasAt > 0 && depositCreditAt > depositCasAt, "deposit wallet credit must follow successful compare-and-set");
assert.ok(route.indexOf("assertFinancialStatusUpdateSucceeded(transition.count)", withdrawalCasAt) < withdrawalEffectsAt, "withdrawal compare-and-set result must be checked before wallet effects");
assert.ok(route.indexOf("assertFinancialStatusUpdateSucceeded(transition.count)", depositCasAt) < depositCreditAt, "deposit compare-and-set result must be checked before credit");
assert.match(route, /if\(\["COMPLETED","REJECTED","FAILED"\]\.includes\(w\.status\)\)return w/, "repeating final withdrawal status exits before updating or side effects");
const depositEndpointEnd = route.indexOf('if(action==="supportReply")', depositBranchAt);
const depositEndpoint = route.slice(depositBranchAt, depositEndpointEnd);
assert.match(depositEndpoint, /if\(d\.status==="COMPLETED"\)return d/, "completed deposit exits before updating or repeating credit");
assert.doesNotMatch(depositEndpoint, /if\(\["COMPLETED","FAILED","EXPIRED"\]\.includes\(d\.status\)\)return d/, "failed and expired deposits must not be treated as completed by the endpoint");
for (const status of ["FAILED", "EXPIRED"]) {
  assert.equal(policy.canTransitionDepositStatus(status, "COMPLETED"), true, `${status} retry is allowed by policy`);
  assert.match(depositEndpoint, new RegExp(`status===\\"COMPLETED\\"[\\s\\S]*creditWallet\\(tx,owner.userId,Number\\(d.amount\\),\x60deposit:\\$\\{d.providerTxId\\}`), `${status} retry reaches endpoint's compare-and-set and settlement path`);
}
assert.match(route, /FINANCIAL_STATUS_CONFLICT.*status:409/, "compare-and-set race must return HTTP 409");
assert.match(route, /message==="FORBIDDEN"\)return NextResponse\.json\(\{error:"Недостаточно прав"\},\{status:403\}\)/, "missing permission must map to HTTP 403");
assert.match(route, /ADMIN_LOGIN_REQUIRED.*status:401/, "missing admin session must map to HTTP 401");
assert.match(route, /deposit:\$\{d\.providerTxId\}/, "deposit idempotency key must remain unchanged");
assert.match(route, /withdraw-refund:\$\{w\.id\}/, "withdrawal refund idempotency key must remain unchanged");
assert.match(route, /withdrawal-close:\$\{w\.id\}:COMPLETED/, "withdrawal hold completion key must remain unchanged");

console.log("Financial RBAC role boundaries, transition permissions, status transitions, auth ordering and idempotency: PASS");
