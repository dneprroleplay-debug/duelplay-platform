import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const adminApi = read("../app/api/admin/access/users/route.ts");
const adminUi = read("../components/Admin/AdminUsersPresence.tsx");
const matchesApi = read("../app/api/matches/route.ts");
const home = read("../app/page.tsx");
const recent = read("../components/Home/RecentMatches.tsx");
const matchesPage = read("../app/matches/page.tsx");
const live = read("../components/Live/Live.tsx");
const linkEmail = read("../app/api/auth/link-email/route.ts");
const verifyEmail = read("../app/api/auth/link-email/verify/route.ts");
const origin = read("../lib/steam-link-security.ts");
const rating = read("../app/rating/page.tsx");

assert.match(adminApi, /createdAt:\s*true/);
assert.match(adminApi, /createdAt:\s*u\.createdAt\.toISOString\(\)/);
assert.match(adminUi, /registrationLabel\(language\)/);
assert.match(matchesApi, /searchParams\.get\("recent"\) === "1"/);
assert.match(matchesApi, /orderBy:\s*\[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
assert.match(matchesApi, /take:\s*5/);
assert.match(home, /<RecentMatches\/>/);
assert.match(recent, /href="\/matches"/);
assert.match(matchesPage, /economy==="DEMO"\?\s*"\/create-demo"/);
assert.match(matchesPage, /<Live mode="waiting" showFilters economy=\{economy\}\/>/);
assert.match(live, /economy === "DEMO" \? "\/matches\?economyMode=DEMO"/);
assert.match(linkEmail, /DUELPLAY_PUBLIC_URL/);
assert.match(verifyEmail, /DUELPLAY_PUBLIC_URL/);
assert.match(origin, /originHeader !== supplied\.origin/);
assert.match(rating, /x\.id === user\.id/);
assert.match(rating, /shadow-\[inset_0_0_0_1px_rgba\(255,47,145/);
for (const lang of ["Регистрация", "Реєстрація", "Rejestracja", "Registered"]) assert.ok(adminUi.includes(lang));
for (const lang of ["Последние матчи", "Останні матчі", "Ostatnie mecze", "Latest matches"]) assert.ok(recent.includes(lang));
console.log("Six site/admin/email/rating fixes: source-contract checks PASS");


// Follow-up founder/email/Steam/frame requirements.
const login = read("../components/Auth/LoginPage.tsx");
const profile = read("../app/profile/page.tsx");
const framesCss = read("../app/globals.css");
assert.match(adminApi, /adminRoleAssignment:\s*\{\s*select:\s*\{ roleCode: true, level: true \} \}/);
assert.match(adminApi, /assignedRole === "FOUNDER" && u\.adminRoleAssignment\?\.level === 999/);
assert.match(adminApi, /roleCode = isFounder \? "FOUNDER" : assignedRole \|\| u\.role/);
assert.match(adminUi, /FOUNDER · 999/);
assert.match(linkEmail, /mailto:support@duelplaygame\.com/);
assert.match(linkEmail, /Подтверди Email/);
assert.match(linkEmail, /10 минут/);
assert.match(linkEmail, /role="presentation"/);
assert.match(profile, /mailto:support@duelplaygame\.com/);
assert.match(profile, /Boolean\(u\.emailVerifiedAt&&u\.email\)/);
assert.match(profile, /supportHelp/);
assert.match(login, /}, 240_000\)/);
assert.match(login, /keep the popup\/channel listeners alive/);
for (const slug of ["neon-frame", "pink-signal", "pink-scheme", "violet-vector", "deep-prism", "titanium-rose", "golden-sovereign", "rising-eclipse"]) assert.ok(framesCss.includes(`frame-glow--${slug}`), `missing frame animation ${slug}`);
assert.match(framesCss, /prefers-reduced-motion:reduce/);
console.log("Founder/email/support/Steam/frame follow-up checks: PASS");
