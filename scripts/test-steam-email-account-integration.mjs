import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isCs2GdbDiagnosticConsumed, markCs2GdbDiagnosticConsumed } from "./server-manager/cs2-gdb-diagnostic-state.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [schema, register, verify, me, profileApi, profilePage, steamStart, steamCallback, loginPage, authContext, matchStart, claimRoute, serverManager, cs2GdbDiag] = await Promise.all([
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
  read("scripts/server-manager/cs2-gdb-diag.sh"),
]);
let checks = 0;
function check(condition, message) { assert.ok(condition, message); checks += 1; }

const cs2GdbDiagScript = cs2GdbDiag;
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
check(/const AVATAR_OVERRIDE_ENABLED = (true|false);/.test(serverManager), "Native avatar override switch exists in the server manager");
const avatarCallPattern = /command\(`duelplay_set_player_avatar/g;
const avatarCallPositions = [];
let avatarMatch = avatarCallPattern.exec(serverManager);
while (avatarMatch) { avatarCallPositions.push(avatarMatch.index); avatarMatch = avatarCallPattern.exec(serverManager); }
check(avatarCallPositions.length === 3, `Manager exposes exactly 3 avatar override call sites (found ${avatarCallPositions.length})`);
for (const pos of avatarCallPositions) {
  check(serverManager.slice(Math.max(0, pos - 1200), pos).includes("if (!AVATAR_OVERRIDE_ENABLED)"), `Avatar override call at position ${pos} is preceded by the AVATAR_OVERRIDE_ENABLED guard`);
}

check(/const CS_DIAGNOSE_GDB = \["1", "true", "yes"\]\.includes\(String\(process\.env\.DUELPLAY_CS2_DIAGNOSE_GDB \?\? ""\)\.trim\(\)\.toLowerCase\(\)\);/.test(serverManager), "CS2 GDB diagnostic mode flag exists in the server manager");
check(/import \{ isCs2GdbDiagnosticConsumed, markCs2GdbDiagnosticConsumed \} from '\.\/cs2-gdb-diagnostic-state\.mjs';/.test(serverManager), "Server manager delegates one-shot GDB state to the dedicated state module");
check(/const CS_DIAGNOSE_GDB_WRAPPER = "\/home\/ubuntu\/duelplay-app\/scripts\/server-manager\/cs2-gdb-diag.sh";/.test(serverManager), "Server manager passes the cs2-gdb-diag wrapper through GAME_DEBUGGER only for the diagnostic run");
check(/const csDiagnoseGdb = CS_DIAGNOSE_GDB && !isCs2GdbDiagnosticConsumed\(\) && SERVER_ID === 'cs2-2';/.test(serverManager), "GDB diagnostic mode is enabled only for the cs2-2 run and not for cs2-1/cs2-3");
check(/const csDiagnoseGdbArmed = csDiagnoseGdb && markCs2GdbDiagnosticConsumed\(\);/.test(serverManager), "GDB diagnostic arm is derived only after the one-shot marker consumption succeeds");
check(/if \(csDiagnoseGdbArmed\) \{ csDiagnoseGdbActive = true; \}/.test(serverManager), "GDB diagnostic arm activates the debugger-owned child only after successful marker consumption");
check(/if \(csDiagnoseGdb && !csDiagnoseGdbArmed\) \{ console\.error/.test(serverManager), "Manager logs a clear error and falls back to the standard CS2 launch when the GDB marker cannot be saved");
check(/if \(csDiagnoseGdbActive\) return false;/.test(serverManager), "Manager suppresses CS2 stdin game commands while the GDB diagnostic process owns the child");
check(/env: \{ \.\.\.process\.env, \.\.\.\(csDiagnoseGdbArmed/.test(serverManager) && /GAME_DEBUGGER: CS_DIAGNOSE_GDB_WRAPPER/.test(serverManager), "Manager passes the cs2-gdb-diag wrapper through GAME_DEBUGGER only for the armed diagnostic run");
check(/child\.on\('error', async \(error\) => \{\n    csDiagnoseGdbActive = false;/.test(serverManager), "Manager clears the GDB diagnostic child state on spawn error as well as on exit");
check(/child\.on\('exit', async \(code, signal\) => \{\n    clearCurrentTimers\(\);\n    csDiagnoseGdbActive = false;/.test(serverManager), "Manager clears the GDB diagnostic child state after the CS2 process exits");
check(cs2GdbDiagScript.includes("thread apply all bt full"), "cs2-gdb-diag wrapper runs thread apply all bt full on SIGSEGV");
check(cs2GdbDiagScript.includes("info proc mappings"), "cs2-gdb-diag wrapper captures process mappings on SIGSEGV");
check(cs2GdbDiagScript.includes("info sharedlibrary"), "cs2-gdb-diag wrapper captures loaded shared libraries on SIGSEGV");
check(cs2GdbDiagScript.includes("handle SIGSEGV stop print"), "cs2-gdb-diag wrapper stops on SIGSEGV without passing it on");
check(cs2GdbDiagScript.includes("set logging file"), "cs2-gdb-diag wrapper writes gdb logs to a timestamped per-server file");

const gdbOneShotDir = mkdtempSync(join(tmpdir(), "duelplay-gdb-once-"));
const gdbOneShotMarker = join(gdbOneShotDir, "once");
check(!isCs2GdbDiagnosticConsumed(gdbOneShotMarker), "GDB diagnostic one-shot allows a diagnostic run when the marker is absent");
check(markCs2GdbDiagnosticConsumed(gdbOneShotMarker), "GDB diagnostic one-shot marker is consumable when the state file is writable");
check(isCs2GdbDiagnosticConsumed(gdbOneShotMarker), "GDB diagnostic one-shot forbids a repeat after the marker is consumed");
check(isCs2GdbDiagnosticConsumed(gdbOneShotMarker), "GDB diagnostic one-shot stays forbidden after a simulated manager restart");
const gdbUnwritableMarker = join(gdbOneShotDir, "unwritable");
mkdirSync(gdbUnwritableMarker);
check(markCs2GdbDiagnosticConsumed(gdbUnwritableMarker) === false, "GDB diagnostic does not arm when the one-shot marker cannot be saved");
rmSync(gdbOneShotDir, { recursive: true, force: true });

console.log(`Steam/email account integration contract checks: PASS (${checks} assertions)`);
