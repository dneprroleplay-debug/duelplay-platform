import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [schema, register, verify, me, profileApi, profilePage, steamStart, steamCallback, loginPage, authContext, matchStart, claimRoute, serverManager] = await Promise.all([
  read("prisma/schema.prisma"),
  read("app/api/auth/register/route.ts"),
  read("app/api/auth/verify-email/route.ts"),
  read("app/api/auth/me/route.ts"),
  read("app/api/profile/route.ts"),
  read("app/profile/page.tsx"),
  read("app/api/auth/steam/route.ts"),
  read("app/api/auth/steam/callback/route.ts"),
  read("components/Auth/LoginPage.tsx"),
  read("components/Common/AuthContext.tsx"),
  read("app/api/matches/[id]/start/route.ts"),
  read("app/api/server-manager/claim/route.ts"),
  read("scripts/server-manager/server-manager.mjs"),
]);
let checks = 0;
function check(condition, message) { assert.ok(condition, message); checks += 1; }

const userModel = schema.match(/model User\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
check(/steamId\s+String\?\s+@unique/.test(userModel), "User.steamId remains nullable and unique for email-only accounts");
check(/email\s+String\?\s+@unique/.test(userModel) && /id\s+String\s+@id/.test(userModel), "User has an independent internal ID and optional email");
check(register.includes("tx.user.create(") && register.includes("wallet: { create: {} }") && !/steamId\s*:/.test(register), "Email registration creates a normal User and wallet without setting a Steam ID");
check(/emailVerifiedAt:\s*new Date\(\)/.test(verify), "Email verification marks the existing user as verified");
check(/where:\s*\{\s*token:\s*hashToken\(token\)/.test(me) && /id:\s*session\.user\.id/.test(me), "Current-user endpoint resolves the session to the internal user ID");
check(/where:\s*\{\s*OR:\s*\[\{\s*playerOneId:\s*user\.id\s*\}/.test(profileApi), "Profile statistics and history queries are scoped by internal user ID");
check(/Steam не привязан/.test(profilePage) && /Привязать Steam/.test(profilePage), "Profile offers explicit Steam linking for an email account");
check(/Для запуска настоящих CS2-матчей оба игрока должны привязать Steam/.test(profilePage), "Profile explains the Steam requirement for real CS2 matches");
check(/intent=link/.test(profilePage) && /steam_conflict/.test(profilePage), "Profile starts a dedicated link intent and surfaces Steam conflicts");
check(/export async function POST/.test(steamStart) && /setStateCookie\(response, state, "link"/.test(steamStart) && /setStateCookie\(response, state, "login"/.test(steamStart), "Steam login and authenticated link use separate start paths and state cookies");
check(/openid\.mode.*checkid_setup/.test(steamStart) && /randomBytes\(24\)/.test(steamStart), "Steam OpenID retains random state and the existing OpenID mechanism");
check(/verifySteamOpenId\(url\.searchParams\)/.test(steamCallback), "Callback verifies the actual Steam OpenID response before using Steam ID");
check(/steamId: null/.test(steamCallback) && /tx\.user\.updateMany/.test(steamCallback), "Link operation only attaches to an unlinked current user");
check(/owner\.id !== userId/.test(steamCallback) && /STEAM_CONFLICT/.test(steamCallback), "Steam IDs owned by another account return a conflict");
check(/user\.steamId === steamId/.test(steamCallback) && /already-linked/.test(steamCallback), "Repeated link callback for the same Steam ID is idempotent");
check(/P2002/.test(steamCallback) && /STEAM_CONFLICT/.test(steamCallback), "Unique-constraint race is converted into a safe conflict");
check(/if \(intent === "link"\)[\s\S]*?if \(!linkSession\)/.test(steamCallback), "Link intent requires the original authenticated DuelPlay session");
check(/response\.cookies\.set\(\{ \.\.\.sessionCookieOptions\(\), value: token \}\)/.test(steamCallback), "Login session cookie is set on the successful callback response before popup script executes");
check(/window\.opener\.postMessage\(payload,targetOrigin\)/.test(steamCallback) && /BroadcastChannel/.test(steamCallback), "Popup result uses exact-origin postMessage plus same-origin BroadcastChannel fallback");
check(!/postMessage\([^,]+,\s*["']\*["']/.test(steamCallback), "Popup does not use wildcard targetOrigin");
check(/duelplay:steam-auth-error/.test(steamCallback) && /steam_conflict/.test(steamCallback), "Error callbacks emit an error result, never a success result");
check(/event\.origin !== window\.location\.origin/.test(loginPage) && /event\.source !== steamPopupRef\.current/.test(loginPage) && /result\.intent !== "login"/.test(loginPage), "Login tab validates message origin, expected popup source, and login intent");
check(/refresh\(\)/.test(loginPage) && /router\.replace\("\/"\)/.test(loginPage), "Login tab verifies the real session and redirects after refresh");
check(/new BroadcastChannel\("duelplay-steam-oauth-v1"\)/.test(loginPage) && /240_000/.test(loginPage), "Login tab listens for OAuth completion with the extended finite 240-second timeout");
check(/refresh: \(\) => Promise<HeaderUser \| null>/.test(authContext), "AuthContext refresh returns the server-confirmed user without requiring a second request");
check(/STEAM_REQUIRED/.test(matchStart) && /!match\.playerOne\.steamId \|\| !match\.playerTwo\?\.steamId/.test(matchStart), "A real match cannot start without actual Steam IDs (except existing local test accounts)");
check(/STEAM_REQUIRED/.test(claimRoute) && /!match\.playerOne\.steamId \|\| !match\.playerTwo\?\.steamId/.test(claimRoute), "Server manager refuses to claim a real match without Steam IDs");
check(/playerOneNickname: match\.playerOne\.nickname/.test(claimRoute) && /playerOneAvatarUrl: match\.playerOne\.avatarUrl \?\? match\.playerOne\.steamAvatarUrl/.test(claimRoute), "Claim payload passes DuelPlay nickname and selected avatar URL");
check(/duelplay_set_player_name/.test(serverManager) && /duelplay_set_player_avatar/.test(serverManager) && /preparePlayerAvatar\(steamId, avatarUrl\)/.test(serverManager), "Existing manager resolves player identity and passes name/avatar through existing game commands");
check(/if \(!steamId \|\| !avatarUrl\) return null/.test(serverManager), "Avatar sync safely skips missing Steam ID or avatar URL");

console.log(`Steam/email account integration contract checks: PASS (${checks} assertions)`);
