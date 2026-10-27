import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateSiteSocialLinks } from "../lib/site-social-links-policy.ts";

const valid = {
  discord: "https://discord.gg/KBk8pQNhKj",
  steamGroup: "https://steamcommunity.com/groups/duelplay/",
  telegram: "https://t.me/DuelPlayGame",
  supportUrl: "https://discord.gg/KBk8pQNhKj",
  supportEmail: "support@duelplaygame.com",
};
assert.equal(validateSiteSocialLinks(valid).ok, true, "accept current default links");
assert.equal(validateSiteSocialLinks({ ...valid, discord: "javascript:alert(1)" }).ok, false, "reject javascript URL");
assert.equal(validateSiteSocialLinks({ ...valid, discord: "http://discord.gg/example" }).ok, false, "reject non-HTTPS URL");
assert.equal(validateSiteSocialLinks({ ...valid, telegram: "" }).ok, false, "reject empty required URL");
assert.equal(validateSiteSocialLinks({ ...valid, supportEmail: "not-an-email" }).ok, false, "reject malformed support email");
assert.equal(validateSiteSocialLinks({ ...valid, supportUrl: "https://user:pass@example.com" }).ok, false, "reject embedded credentials");

const rbac = await readFile(new URL("../lib/admin-rbac.ts", import.meta.url), "utf8");
const api = await readFile(new URL("../app/api/admin/social-links/route.ts", import.meta.url), "utf8");
const ui = await readFile(new URL("../components/Admin/LegacyAdminPanel.tsx", import.meta.url), "utf8");
assert.match(rbac, /CONTENT_ADMIN:[\s\S]*?settings\.content\.manage/, "CONTENT_ADMIN uses existing content-settings permission");
assert.match(rbac, /FOUNDER:[\s\S]*?permissions: \["\*"\]/, "Founder level 999 retains wildcard access");
assert.match(api, /requirePermission\("settings\.content\.manage"\)/, "API enforces server-side permission");
assert.match(api, /auditRequest\(request, access\.user\.id, "CHANGE_SOCIAL_LINKS"/, "settings changes are audited");
assert.match(ui, /can\("settings\.content\.manage"\)&&<SocialLinksSettings\/>/, "admin UI is gated by existing permission");

console.log("Site social links validation and RBAC scenarios: PASS (11 assertions)");
