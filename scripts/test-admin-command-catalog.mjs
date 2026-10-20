import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const catalogSource = read("lib/admin-commands.ts");
const rbac = read("lib/admin-rbac.ts");
const legacy = read("components/Admin/LegacyAdminPanel.tsx");
const accessPage = read("app/admin/access/page.tsx");

const entries = [...catalogSource.matchAll(/^\s*\["([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)"/gm)]
  .map((m) => ({ permission: m[1], title: m[2], group: m[4], tab: m[6] }));

assert.ok(entries.length >= 40, `command catalog must stay substantial (found ${entries.length})`);
assert.equal(new Set(entries.map((e) => e.permission)).size, entries.length, "command permissions must be unique");

for (const entry of entries) {
  assert.ok(rbac.includes(`"${entry.permission}"`), `${entry.permission} must exist in the server-side RBAC catalog`);
  assert.ok(entry.title.trim().length > 0, `${entry.permission} must have a title`);
  assert.ok(entry.group.trim().length > 0, `${entry.permission} must have a group`);
  assert.ok(entry.tab.trim().length > 0, `${entry.permission} must point at a tab`);
}

const remappedTabs = new Set(["users", "roles", "dashboard"]);
const implementedTabs = new Set([...legacy.matchAll(/tab==="([^"]+)"/g)].map((m) => m[1]));
for (const entry of entries) {
  if (remappedTabs.has(entry.tab)) continue;
  assert.ok(implementedTabs.has(entry.tab), `${entry.permission} points at unimplemented tab ${entry.tab}`);
}

for (const missing of [
  "matches.investigate", "evidence.manage", "incidents.view", "incidents.manage",
  "security.manage", "security.mfa.manage", "security.devices.view", "security.login_history.view",
  "finance.freeze", "finance.reconciliation.view", "finance.source_of_funds.view",
  "maps.manage", "modes.manage", "admin.audit.write",
  "roles.assign", "staff.admin_invite",
]) {
  assert.ok(!entries.some((entry) => entry.permission === missing), `${missing} has no implemented administrative surface and must not be advertised`);
}

for (const required of ["deposits.approve", "deposits.reject", "withdrawals.approve", "withdrawals.complete", "withdrawals.reject", "users.restrict", "disputes.resolve", "evidence.view", "system.maintenance", "content.manage", "reports.view"]) {
  assert.ok(entries.some((entry) => entry.permission === required), `${required} must be present in the command catalog`);
}

assert.match(accessPage, /ADMIN_COMMAND_CATALOG/, "access page must consume the canonical catalog");
assert.match(accessPage, /command\?\.tab==="users"&&command\?\.permission==="users\.view"/, "only the read-only users command may open the presence view");
assert.match(accessPage, /ADMIN_GROUP_ICONS/, "access page must use the shared group icons");

const disputes = read("app/api/disputes/route.ts");
const reports = read("app/api/reports/route.ts");
const maintenance = read("app/api/maintenance/route.ts");
const platform = read("app/api/platform-settings/route.ts");
const flags = read("app/api/feature-flags/route.ts");
const site = read("app/api/site-settings/route.ts");
const accessApi = read("app/api/admin/access/route.ts");
const adminApi = read("app/api/admin/route.ts");
const contentApi = read("app/api/admin/content/route.ts");
const casesApi = read("app/api/admin/cases/route.ts");
const reportsUi = read("components/Admin/AdminReportsWorkspace.tsx");
const contentUi = read("components/Admin/AdminContentWorkspace.tsx");
const permissionOnlyAdminApis = [
  ["app/api/banners/route.ts", "content.manage"],
  ["app/api/events/route.ts", "content.manage"],
  ["app/api/holidays/route.ts", "content.manage"],
  ["app/api/tournaments/route.ts", "content.manage"],
  ["app/api/creator/route.ts", "creator.payouts.manage"],
  ["app/api/deposit-promotions/route.ts", "settings.manage"],
  ["app/api/promo-campaigns/route.ts", "settings.manage"],
  ["app/api/promo-codes/route.ts", "settings.manage"],
  ["app/api/referral-race/route.ts", "settings.manage"],
  ["app/api/admin/revenue/route.ts", "finance.view"],
];
for (const [file, permission] of permissionOnlyAdminApis) {
  const source = read(file);
  assert.ok(!source.includes("requireAdmin("), `${file} must not use numeric legacy admin gates`);
  assert.ok(source.includes(`requirePermission("${permission}")`), `${file} must require ${permission}`);
}

assert.ok(!disputes.includes("requireAdmin(2)") && disputes.includes('requirePermission("disputes.resolve")'), "dispute resolution must require disputes.resolve, not legacy level 2");
assert.ok(!reports.includes("isModeratorRole") && reports.includes('requirePermission("risk.cases.review")'), "report moderation must use risk.cases.review");
assert.ok(!maintenance.includes("requireAdmin(5)") && maintenance.includes('requirePermission("system.maintenance")'), "maintenance must use system.maintenance permission");
assert.ok(!platform.includes("requireAdmin(5)") && platform.includes('requirePermission("settings.manage")'), "platform settings must use settings.manage permission");
assert.ok(!flags.includes("requireAdmin(5)") && flags.includes('requirePermission("feature_flags.manage")'), "feature flags must use feature_flags.manage permission");
assert.ok(!site.includes("requireAdmin(5)") && site.includes('requirePermission("settings.content.manage")'), "site settings must use settings.content.manage permission");
assert.ok(accessApi.includes('await requirePermission("roles.assign")'), "role assignment must require roles.assign as well as roles.manage");
assert.ok(accessApi.split("export async function DELETE")[1]?.includes('await requirePermission("roles.assign")'), "role removal must require roles.assign as well as roles.manage");
assert.ok(adminApi.includes("evidences:{orderBy:{createdAt:\"desc\"}}"), "admin dispute payload must include evidence");
assert.ok(adminApi.includes('evidences:can("evidence.view")?d.evidences:[]'), "evidence must be redacted without evidence.view");
assert.ok(reports.includes('hasPermission(access.permissions, "reports.view")'), "reports.view must grant read access to the report queue");
assert.match(reports, /export async function PATCH[\s\S]*?requirePermission\("risk\.cases\.review"\)/, "report status changes must still require risk.cases.review");
assert.ok(!contentApi.includes("requireAdmin(5)") && contentApi.includes('requirePermission("content.manage")'), "content management must use content.manage without a legacy gate");
assert.ok(!casesApi.includes("requireAdmin(5)") && casesApi.includes('requirePermission("content.manage")'), "case management must use content.manage without a legacy gate");
assert.ok(contentApi.includes('itemType: body.itemType ?? "COSMETIC"') && contentApi.includes("itemType: body.itemType !== undefined ? body.itemType : current.type"), "content item create/update must not treat the ITEM discriminator as a cosmetic type");
assert.ok(contentApi.includes("body.missionType !== undefined") && !contentApi.includes('["name", "description", "type", "reward"]'), "mission updates must not overwrite the mission type with the MISSION discriminator");
assert.ok(contentUi.includes("/api/admin/content") && contentUi.includes('method: "POST"'), "content workspace must be wired to the content API");
assert.ok(reportsUi.includes("/api/reports") && reportsUi.includes('method: "PATCH"'), "reports workspace must be wired to the reports API");
assert.ok(legacy.includes('tab==="content"&&<AdminContentWorkspace/>'), "content tab must render the content workspace");
assert.ok(legacy.includes('tab==="reports"&&<AdminReportsWorkspace'), "reports tab must render the reports workspace");
assert.ok(legacy.includes('can("security.sessions.revoke_all")'), "settings tab must be reachable for security session revocation");

assert.ok(legacy.includes('can("users.restrict")'), "users status control must be gated by users.restrict");
assert.ok(legacy.includes("setResolveTarget"), "dispute resolution UI must exist");
assert.ok(legacy.includes('can("evidence.view")&&x.evidences'), "evidence must render behind evidence.view");
assert.ok(legacy.includes('can("deposits.approve")'), "deposit approval must be gated by deposits.approve");
assert.ok(legacy.includes('can("deposits.reject")'), "deposit rejection must be gated by deposits.reject");
assert.ok(legacy.includes('can("withdrawals.complete")'), "withdrawal completion must be gated by withdrawals.complete");
assert.ok(legacy.includes('can("withdrawals.approve")'), "withdrawal approval must be gated by withdrawals.approve");
assert.ok(!legacy.includes('can("deposits.review")&&<button'), "deposits.review must not render approval controls");
assert.ok(legacy.includes('status:"PROCESSING"') && legacy.includes('status:"COMPLETED"'), "withdrawal UI must use the PROCESSING -> COMPLETED flow");
assert.ok(legacy.includes('can("withdrawals.reject")&&["PENDING","MANUAL_REVIEW","PROCESSING"]'), "withdrawal rejection must be limited to non-terminal states");
assert.ok(legacy.includes('creator:can("creator.payouts.manage")'), "creator tab must be gated by creator.payouts.manage");
assert.equal((legacy.match(/tab==="finance"/g) || []).length, 1, "finance tab must be rendered once");
assert.ok(legacy.includes("Платформенные настройки"), "platform settings panel must be available");
assert.ok(legacy.includes('can("feature_flags.manage")&&<Panel title="Feature Flags"'), "feature flag panel must be available");
assert.ok(legacy.includes('can("system.maintenance")&&<Panel title="Режим обслуживания"'), "maintenance panel must be available");
assert.ok(legacy.includes("savePlatformSetting"), "platform setting changes must be wired to the API");
assert.ok(legacy.includes("toggleMaintenance"), "maintenance toggle must be wired to the API");

console.log(`Admin command catalog and guards: ${entries.length} commands PASS`);
