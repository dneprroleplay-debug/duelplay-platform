import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { verificationEmailHtml, passwordResetEmailHtml } from "../lib/auth-email-templates.ts";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const registration = await read("../components/Auth/RegisterPage.tsx");
const verifyPage = await read("../app/verify-email/page.tsx");
const footer = await read("../components/Footer/Footer.tsx");
const login = await read("../components/Auth/LoginPage.tsx");
const callback = await read("../app/api/auth/steam/callback/route.ts");
const templateSource = await read("../lib/auth-email-templates.ts");

assert.match(registration, /Отображение никнейма и аватара в самой игре зависит от интеграции и настроек конкретного игрового сервера/);
assert.match(registration, /Аватар можно поменять позже в настройках профиля/);
assert.equal((registration.match(/target="_blank" rel="noopener noreferrer"/g) || []).length, 2, "terms and privacy links open safely in new tabs");
assert.match(verifyPage, /window\.location\.hash\.match\(\/\^#code=/, "verification page reads code from URL fragment");
assert.match(verifyPage, /navigator\.clipboard\.writeText\(code\)/, "copy uses Clipboard API when available");
assert.match(verifyPage, /document\.execCommand\("copy"\)/, "copy has a selection-based fallback");

const mail = verificationEmailHtml("TestPlayer", "AB12CD");
assert.match(mail, /Скопировать код/);
assert.match(mail, /href="https:\/\/duelplaygame\.com\/verify-email#code=AB12CD"/);
assert.match(mail, /AB12CD/, "code remains visible for manual copy");
assert.doesNotMatch(mail, /<script\b/i, "email template does not contain executable JavaScript");
assert.match(mail, /Код действует 10 минут/, "verification expiry remains unchanged");

const resetMatch = templateSource.match(/export function passwordResetEmailHtml\([\s\S]*?\n}/);
assert.ok(resetMatch, "password reset template exists");
assert.equal(createHash("sha256").update(resetMatch[0]).digest("hex"), "296e9e73780ee3b663d77507019bbd80e4e58e380bebe8b14e8a76c1d2893b40", "password reset template unchanged");

assert.match(footer, /href=\{`mailto:\$\{social\.supportEmail\}`\}/, "footer uses centrally loaded support email");
assert.match(footer, /\{social\.supportEmail\}/);
assert.doesNotMatch(footer, /Discord Support|Support email:/, "no duplicate support button or second email row");
assert.match(footer, /href=\{social\.discord\}/);
assert.match(footer, /href=\{social\.steamGroup\}/);
assert.match(footer, /href=\{social\.telegram\}/);

assert.match(login, /event\.origin !== window\.location\.origin/);
assert.match(login, /event\.source !== steamPopupRef\.current/);
assert.match(login, /duelplay:steam-auth-complete/);
assert.match(login, /await refresh\(\)/, "AuthContext refresh confirms the real server session");
assert.match(login, /window\.location\.href = steamHref/, "popup-blocked fallback retains old same-tab OAuth");
assert.match(callback, /window\.opener\.postMessage\(payload,targetOrigin\)/);
assert.match(callback, /new BroadcastChannel/);
assert.match(callback, /response\.cookies\.set\(\{ \.\.\.sessionCookieOptions\(\), value: token \}\)/);
assert.ok(callback.indexOf("response.cookies.set({ ...sessionCookieOptions(), value: token })") < callback.indexOf("return clearStateCookie(response)", callback.indexOf("response.cookies.set({ ...sessionCookieOptions(), value: token })")), "session cookie is set before successful callback response is returned");
assert.match(callback, /window\.location\.replace\(targetOrigin\+fallback\)/, "direct callback navigation falls back to the appropriate page");

console.log("Auth final polish: PASS (updated callback contracts)");
