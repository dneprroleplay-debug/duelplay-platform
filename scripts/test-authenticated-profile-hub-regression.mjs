import fs from "node:fs";
import assert from "node:assert/strict";

const read = (p) => fs.readFileSync(p, "utf8");
const profileApi = read("app/api/profile/[nickname]/route.ts");
const profilePage = read("app/profile/[nickname]/page.tsx");
const hubPage = read("app/hub/page.tsx");
const hubClient = read("app/hub/HubClient.tsx");
const header = read("components/Header/Header.tsx");
const steam = read("app/api/auth/steam/callback/route.ts");
const reset = read("scripts/reset-test-users.mjs");

assert.match(profileApi, /const viewer=await getCurrentUser\(\)/);
assert.match(profileApi, /if\(!viewer\) return NextResponse\.json\(\{error:"Войдите в аккаунт"\},\{status:401\}\)/);
assert.match(profilePage, /if\(r\.status===401\)\{window\.location\.href="\/login";return null\}/);
assert.match(hubPage, /const user = await getCurrentUser\(\)/);
assert.match(hubPage, /if \(!user\) redirect\("\/login"\)/);
assert.match(header, /\{user&&<><Link className=\{navClass\} href="\/profile"/);
assert.match(steam, /avatarUrl:null,steamAvatarUrl:profile\.avatarUrl/);
assert.match(reset, /avatarUrl: null,/);
console.log("authenticated profile/hub + avatar semantics: PASS");
