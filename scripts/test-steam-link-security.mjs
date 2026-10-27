import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isBoundToSameSession, isSameOriginRequest } from "../lib/steam-link-security.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [start, callback, profile, schema, register, loginCallback, join, startMatch, claim, manager] = await Promise.all([
  read("app/api/auth/steam/route.ts"),
  read("app/api/auth/steam/callback/route.ts"),
  read("app/profile/page.tsx"),
  read("prisma/schema.prisma"),
  read("app/api/auth/register/route.ts"),
  read("app/api/auth/steam/callback/route.ts"),
  read("app/api/matches/[id]/join/route.ts"),
  read("app/api/matches/[id]/start/route.ts"),
  read("app/api/server-manager/claim/route.ts"),
  read("scripts/server-manager/server-manager.mjs"),
]);
let checks = 0;
function check(condition, message) { assert.ok(condition, message); checks += 1; }

// Execute the same-origin/session-binding helpers, including negative cases.
check(isSameOriginRequest("https://duelplaygame.com", "https://duelplaygame.com"), "same-origin POST is accepted");
check(!isSameOriginRequest(null, "https://duelplaygame.com"), "missing Origin is rejected");
check(!isSameOriginRequest("null", "https://duelplaygame.com"), "opaque Origin is rejected");
check(!isSameOriginRequest("https://evil.example", "https://duelplaygame.com"), "cross-origin POST is rejected");
check(!isSameOriginRequest("not a URL", "https://duelplaygame.com"), "malformed Origin is rejected");
check(isBoundToSameSession("user-a", "session-a", "user-a", "session-a"), "original user and session match");
check(!isBoundToSameSession("user-a", "session-a", "user-a", "session-b"), "session switch for same user is rejected");
check(!isBoundToSameSession("user-a", "session-a", "user-b", "session-a"), "user switch is rejected");

// Start/callback security contract.
check(/export async function GET[\s\S]*?intent.*link[\s\S]*?status:\s*405/.test(start), "GET intent=link cannot create state");
check(/export async function POST/.test(start) && /isSameOrigin\(request\)/.test(start), "link start requires same-origin POST");
check(/getSessionCookie\(request\)/.test(start) && /token:\s*hashToken\(rawSessionToken\)/.test(start), "link start validates the current session token hash");
check(/if \(!rawSessionToken\) return NextResponse\.json\([\s\S]*?status:\s*401/.test(start), "link start rejects a missing session");
check(/isRevoked:\s*false/.test(start) && /expiresAt:\s*\{\s*gt:\s*new Date\(\)/.test(start), "revoked and expired sessions are rejected");
check(/STEAM_LINK_STATE_ISSUED/.test(start) && /stateHash, sessionId: session\.id/.test(start), "state issuance is stored server-side with the initiating session ID");
check(/consumeLinkState\(expectedState, linkSession\.userId, linkSession\.id/.test(callback), "callback consumes state bound to initiating user/session");
check(/pg_advisory_xact_lock\(hashtextextended\(\$\{`steam-link-state:\$\{stateHash\}`\}/.test(callback), "state consumption is serialized to prevent concurrent replay");
check(/STEAM_LINK_STATE_CONSUMED/.test(callback) && /if \(consumed\) return false/.test(callback), "reused state is rejected");
check(/isBoundToSameSession\(linkSession\.userId, linkSession\.id, currentSession\.userId, currentSession\.id\)/.test(callback), "callback rejects a changed session before linking");
check(/where:\s*\{\s*id: sessionId, userId, isRevoked: false, expiresAt: \{ gt: new Date\(\) \}/.test(callback), "link transaction rechecks that the original session is still active");
check(/verifySteamOpenId\(url\.searchParams\)/.test(callback), "Steam OpenID response remains server-verified");
check(/owner\.id !== userId/.test(callback) && /STEAM_CONFLICT/.test(callback) && /P2002/.test(callback), "Steam ID ownership conflicts and unique-constraint races remain protected");
check(/if \(user\.steamId && user\.steamId !== steamId\) throw new Error\("STEAM_ALREADY_LINKED"\)/.test(callback), "linking a different Steam ID cannot overwrite an existing link");
check(/if \(intent === "link"\)[\s\S]*?if \(!linkSession\)/.test(callback), "link callback requires a session while login flow remains separate");
check(/return startSteamLogin\(request\)/.test(start) && /intent.*link[\s\S]*?status:\s*405/.test(start), "ordinary GET Steam login remains available without an existing DuelPlay session");
check(/form\.method="POST"/.test(profile) && /api\/auth\/steam\?intent=link/.test(profile), "profile uses POST for linking instead of state-generating GET");
check(/const message = success[\s\S]*?duelplay:steam-auth-complete/.test(callback) && !/sessionToken|sessionCookie|SESSION_COOKIE/.test(callback.slice(callback.indexOf("const message = success"), callback.indexOf("const title = success"))), "popup messages contain only result type/intent and no session secrets");

// Mixed Steam-login + email-login-with-linked-Steam match identity contract.
const userModel = schema.match(/model User\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
check(/steamId\s+String\?\s+@unique/.test(userModel), "email accounts can exist without Steam ID; Steam IDs remain unique");
check(/tx\.user\.create\([\s\S]*?wallet:\s*\{\s*create:\s*\{\}\s*\}/.test(register) && !/steamId\s*:/.test(register), "email registration creates an ordinary user without a fake Steam ID");
check(/STEAM_REQUIRED/.test(startMatch) && /Оба игрока должны привязать Steam/.test(startMatch), "real match start returns a clear Steam-required error for unlinked email users");
check(/playerOneUserId: match\.playerOne\.id/.test(claim) && /playerTwoUserId: match\.playerTwo\.id/.test(claim), "server-manager claim maps each Steam identity to the related internal user ID");
check(/playerOneSteamId: match\.playerOne\.steamId/.test(claim) && /playerTwoSteamId: match\.playerTwo\.steamId/.test(claim), "claim returns each player's actual Steam ID from their linked DuelPlay user");
check(/playerOneUserId: claimed\.playerOneUserId/.test(manager) && /playerTwoUserId: claimed\.playerTwoUserId/.test(manager), "manager retains the internal ID mapping for both players");
check(/playerOneNickname: match\.playerOne\.nickname/.test(claim) && /playerOneAvatarUrl: match\.playerOne\.avatarUrl \?\? match\.playerOne\.steamAvatarUrl/.test(claim), "manager payload associates the right nickname/avatar with player one");
check(/playerTwoNickname: match\.playerTwo\.nickname/.test(claim) && /playerTwoAvatarUrl: match\.playerTwo\.avatarUrl \?\? match\.playerTwo\.steamAvatarUrl/.test(claim), "manager payload associates the right nickname/avatar with player two");
check(/playerTwoId:\s*user\.id/.test(join) && /match\.playerOneId === user\.id/.test(join), "joining player and match ownership are resolved by internal DuelPlay user ID");

console.log(`Steam link security and mixed-account contract tests: PASS (${checks} assertions)`);
console.log("Note: these are executable helper + source-contract tests; a live database-backed CS2 match is still required to verify end-to-end gameplay.");
