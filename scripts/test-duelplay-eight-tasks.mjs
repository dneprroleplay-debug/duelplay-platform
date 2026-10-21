/**
 * Regression test for the eight DuelPlay tasks of this pass.
 *
 * 1. DC wallet: DEMO balance/locked/debt/history are separate from the real USD wallet.
 * 2. Notifications: both match sides are notified for every lifecycle event, the
 *    factual cancellation data is carried, DEMO copy is localized in RU/UA/EN/PL.
 * 3. Map/mode descriptions: localized for every catalogue entry and used on all
 *    four surfaces.
 * 4. Friend progress: 0/3 .. 3/3 and the recalculation on reload.
 * 5. Admin: every command points at an implemented tab and a server permission.
 * 6. Dialogs: no native browser dialogs left, the DuelPlay provider covers
 *    confirm/prompt/alert with keyboard, busy and double-click handling.
 * 7. History and disputes: five recent entries, four filters, cursor paging and
 *    one shared server rule for opening a dispute.
 * 8. Images: every local image matches its extension and every referenced path exists.
 *
 * Run: node scripts/test-duelplay-eight-tasks.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

const root = process.cwd();
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/lib/")) {
      return nextResolve(pathToFileURL(`${root}/lib/${specifier.slice("@/lib/".length)}.ts`).href, context);
    }
    return nextResolve(specifier, context);
  },
});
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));

const LANGUAGES = ["RU", "UA", "EN", "PL"];
let checks = 0;
const check = (condition, message) => {
  checks += 1;
  assert.ok(condition, message);
};

// ---------------------------------------------------------------------------
// 1. DC wallet
// ---------------------------------------------------------------------------
{
  const walletPage = read("app/wallet/page.tsx");
  const demoApi = read("app/api/demo-wallet/route.ts");
  const authMe = read("app/api/auth/me/route.ts");
  check(walletPage.includes("/api/demo-wallet"), "the wallet page loads the DEMO wallet from its own endpoint");
  check(walletPage.includes("/api/wallet/transactions"), "the wallet page loads the real USD transactions separately");
  check(demoApi.includes('currency: "DC"'), "the DEMO wallet endpoint reports the DC currency");
  check(demoApi.includes("lockedBalance") && demoApi.includes("debtBalance"), "the DEMO wallet exposes locked and virtual debt balances");
  check(demoApi.includes("demoTransaction.findMany"), "the DEMO wallet returns its own transaction history");
  check(!demoApi.includes("prisma.wallet"), "the DEMO wallet endpoint never touches the real USD wallet model");
  check(authMe.includes("session.user.wallet?.balance"), "the real balance comes from the real wallet only");
  check(walletPage.includes('formatMatchAmount("DEMO"'), "DEMO amounts are rendered with the DC format");
  check(!/formatMatchAmount\("DEMO",[^)]*user\.balance/.test(walletPage), "the real USD balance is never rendered as DC");
  check(walletPage.includes("DEMO_TRANSACTION_LABELS"), "DEMO transaction types are localized");
  for (const language of LANGUAGES) {
    check(walletPage.includes(`${language}:{title:`), `the DEMO wallet copy exists for ${language}`);
  }
}

// ---------------------------------------------------------------------------
// 2. Notifications
// ---------------------------------------------------------------------------
{
  const join = read("app/api/matches/[id]/join/route.ts");
  const server = read("app/api/matches/[id]/server/route.ts");
  const result = read("app/api/matches/[id]/result/route.ts");
  const lifecycle = read("lib/match-lifecycle.ts");
  const cancel = read("app/api/matches/[id]/cancel/route.ts");
  const admin = read("app/api/admin/route.ts");
  const disputes = read("app/api/disputes/route.ts");
  const demoNotifications = read("lib/demo-notifications.ts");
  const header = read("components/Header/Header.tsx");
  const notificationsPage = read("app/notifications/page.tsx");

  check(join.includes("createMany") && join.includes("MATCH_READY"), "both players are notified when the match becomes ready");
  check(join.includes('economyMode: "DEMO"'), "the ready notification carries the economy mode");
  check(server.includes('type: "MATCH_STARTED"'), "both players are notified when the server is live");
  check(server.includes("match.playerOneId, match.playerTwoId"), "the start notification reaches both match sides");
  check(result.includes('type: "WIN"') && result.includes('type: "LOSS"'), "winner and loser both receive a result notification");
  check(result.includes('type: "TECHNICAL_WIN"') === false && lifecycle.includes('type: "TECHNICAL_WIN"'), "the technical win is reported to the connected player");
  check(lifecycle.includes('type: "CANCELLATION"'), "start/no-connect timeouts notify both players");
  check(cancel.includes('type:"CANCELLATION"') || cancel.includes('type: "CANCELLATION"'), "a player cancellation notifies both players");
  check(admin.includes("cancelMatchWithRefund(id, `Match cancelled by admin ${me.nickname}`, me.nickname)"), "an admin cancellation names the administrator");
  check(lifecycle.includes("cancelledBy") && lifecycle.includes("cancelledAt"), "cancellation notifications carry the actor and the exact time");
  check(disputes.includes("notifyDisputeUpdate"), "dispute updates notify through the shared helper");
  check(disputes.includes('kind: "DISPUTE_OPENED"') && disputes.includes('kind: "DISPUTE_RESOLVED"'), "dispute creation and resolution are both notified");
  check(demoNotifications.includes("MATCH_STARTED") && demoNotifications.includes("DISPUTE_UPDATE"), "DEMO notifications cover the start and the dispute events");
  check(demoNotifications.includes("cancellationDetail"), "the DEMO cancellation body carries the factual reason, actor and time");
  check(header.includes("cancellationDetail"), "the bell shows the factual cancellation data");
  check(notificationsPage.includes("cancellationDetail"), "the notifications page shows the factual cancellation data");
  check(header.includes("openMatch") && notificationsPage.includes("/matches/${String(n.payload?.matchId)}"), "match notifications offer an open-match action");
  const { getDemoNotificationTitle, getDemoNotificationBody } = await import(pathToFileURL(`${root}/lib/demo-notifications.ts`));
  for (const language of LANGUAGES) {
    for (const type of ["SYSTEM", "CANCELLATION", "MATCH_READY", "MATCH_FOUND", "MATCH_STARTED", "WIN", "TECHNICAL_WIN", "LOSS", "REFUND", "DISPUTE_UPDATE"]) {
      const title = getDemoNotificationTitle(language, type, { kind: "DEMO_MATCH_CREATED" });
      const body = getDemoNotificationBody(language, type, { kind: "DEMO_MATCH_CREATED", payout: "12.5" });
      check(typeof title === "string" && title.length > 0, `${language}/${type} has a DEMO title`);
      check(typeof body === "string" && body.length > 0, `${language}/${type} has a DEMO body`);
      check(!body.includes("$"), `${language}/${type} DEMO body never shows a real currency symbol`);
    }
  }
  const { cancellationDetail } = await import(pathToFileURL(`${root}/lib/notification-details.ts`));
  const detail = cancellationDetail("EN", { reason: "Match cancelled by admin Root", cancelledBy: "Root", cancelledAt: "2026-10-21T10:00:00.000Z" });
  check(detail.includes("Match cancelled by admin Root"), "the cancellation detail repeats the actual cancellation text");
  check(detail.includes("Root"), "the cancellation detail names the administrator");
  check(detail.includes("2026") || /\d/.test(detail), "the cancellation detail contains the cancellation time");
}

// ---------------------------------------------------------------------------
// 3. Map and mode descriptions
// ---------------------------------------------------------------------------
{
  const { DUEL_MAPS } = await import(pathToFileURL(`${root}/lib/duel-maps.ts`));
  const { DUEL_MODES } = await import(pathToFileURL(`${root}/lib/duel-modes.ts`));
  const { mapDescription, modeDescription } = await import(pathToFileURL(`${root}/lib/duel-descriptions.ts`));
  for (const map of DUEL_MAPS) {
    for (const language of LANGUAGES) {
      const text = mapDescription(language, map.id, "");
      check(text.length > 10, `${language} map ${map.id} has a description`);
    }
  }
  for (const mode of DUEL_MODES) {
    for (const language of LANGUAGES) {
      const text = modeDescription(language, mode.id, "");
      check(text.length > 10, `${language} mode ${mode.id} has a description`);
    }
  }
  const games = read("components/Games/Games.tsx");
  const createMatch = read("components/CreateMatch/CreateMatch.tsx");
  const demoCreateMatch = read("components/CreateMatch/DemoCreateMatch.tsx");
  const matchPage = read("app/matches/[id]/page.tsx");
  check(games.includes("mapDescription(language"), "the map cards use the localized description");
  check(createMatch.includes("mapDescription(language") && createMatch.includes("modeDescription(language"), "the REAL match creation screen uses localized descriptions");
  check(demoCreateMatch.includes("mapDescription(language") && demoCreateMatch.includes("modeDescription(language"), "the DEMO match creation screen uses localized descriptions");
  check(matchPage.includes("mapDescriptionText(language") && matchPage.includes("modeDescriptionText(language"), "the match details use localized descriptions");
}

// ---------------------------------------------------------------------------
// 4. Friend progress
// ---------------------------------------------------------------------------
{
  const { calculateProfileCompletion } = await import(pathToFileURL(`${root}/lib/profile-completion.ts`));
  const base = { hasCustomAvatar: true, finishedMatches: 1, achievements: 1 };
  for (const friends of [0, 1, 2, 3, 5]) {
    const result = calculateProfileCompletion({ ...base, acceptedFriends: friends });
    const friendsItem = result.items.find((item) => item.id === "friends");
    check(Boolean(friendsItem), `the friends item exists for ${friends} friends`);
    check(friendsItem.complete === (friends >= 3), `${friends} friends ${friends >= 3 ? "complete" : "do not complete"} the friends task`);
    check(result.percent === (friends >= 3 ? 100 : 75), `the total progress with ${friends} friends is recalculated`);
  }
  const profilePage = read("app/profile/page.tsx");
  check(profilePage.includes("profileCompletionProgress.friends"), "the profile page renders the real accepted-friend count");
  check(profilePage.includes("}/3"), "the profile page shows the friends counter as x/3");
  check(profilePage.includes("duelplay:profile-updated"), "the profile page recalculates after a friend request is answered");
}

// ---------------------------------------------------------------------------
// 5. Admin
// ---------------------------------------------------------------------------
{
  const catalog = read("lib/admin-commands.ts");
  const rbac = read("lib/admin-rbac.ts");
  const legacy = read("components/Admin/LegacyAdminPanel.tsx");
  const access = read("app/admin/access/page.tsx");
  const entries = [...catalog.matchAll(/^\s*\["([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)"/gm)]
    .map((match) => ({ permission: match[1], group: match[4], tab: match[6] }));
  check(entries.length >= 40, "the admin command catalog stays substantial");
  const implementedTabs = new Set([...legacy.matchAll(/tab==="([^"]+)"/g)].map((match) => match[1]));
  for (const entry of entries) {
    check(rbac.includes(`"${entry.permission}"`), `${entry.permission} exists in the server-side RBAC catalog`);
    if (!["users", "roles", "dashboard"].includes(entry.tab)) {
      check(implementedTabs.has(entry.tab), `${entry.permission} points at the implemented tab ${entry.tab}`);
    }
  }
  check(access.includes("ADMIN_COMMAND_CATALOG"), "the admin center consumes the canonical catalog");
  check(read("app/api/admin/access/route.ts").includes("requirePermission") || read("app/api/admin/access/route.ts").includes("resolveAdminAccess"), "the admin access API checks the rights on the server");
}

// ---------------------------------------------------------------------------
// 6. Dialogs
// ---------------------------------------------------------------------------
{
  const provider = read("components/Common/DuelDialogProvider.tsx");
  check(provider.includes("confirm:") && provider.includes("prompt:") && provider.includes("alert:"), "the provider exposes confirm, prompt and alert");
  check(provider.includes('event.key === "Escape"'), "the dialogs can be closed with the keyboard");
  check(provider.includes('event.key !== "Enter"'), "the dialogs can be confirmed with the keyboard");
  check(provider.includes("promptBlocked"), "an empty required prompt input cannot be submitted");
  check(provider.includes("aria-busy") || read("components/Common/ConfirmModal.tsx").includes("aria-busy"), "the dialog exposes a busy state");
  check(provider.includes("confirmResolver.current?.(false)"), "a repeated request resolves the previous promise instead of hanging");
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
    }
  };
  walk(path.join(root, "app"));
  walk(path.join(root, "components"));
  walk(path.join(root, "lib"));
  const native = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    if (/window\.(confirm|alert|prompt)\s*\(/.test(text)) native.push(path.relative(root, file));
  }
  check(native.length === 0, `no native browser dialogs are left (found: ${native.join(", ")})`);
  const layout = read("app/layout.tsx");
  check(layout.includes("DuelDialogProvider"), "the dialog provider is mounted globally");
}

// ---------------------------------------------------------------------------
// 7. Match history and disputes
// ---------------------------------------------------------------------------
{
  const matchesApi = read("app/api/matches/route.ts");
  check(matchesApi.includes('HISTORY_STATUS_FILTERS'), "the history API has server-side status filters");
  for (const filter of ["all", "finished", "cancelled", "disputed"]) {
    check(matchesApi.includes(`${filter}:`), `the history API supports the ${filter} filter`);
  }
  check(matchesApi.includes("cursor") && matchesApi.includes("nextCursor"), "the history API supports cursor paging");
  check(matchesApi.includes("take: limit + 1"), "the history API detects more pages");
  const history = read("components/Match/MatchHistory.tsx");
  check(history.includes('id: "all"') && history.includes('id: "finished"') && history.includes('id: "cancelled"') && history.includes('id: "disputed"'), "the history UI offers the four filters");
  check(history.includes("slice(0, 5)"), "the recent block shows the five latest entries");
  check(history.includes("loadMore") && history.includes("nextCursor"), "the history UI can load more entries");
  check(history.includes("href={`/matches/${match.id}`}"), "every history card opens the match details");
  const eligibility = read("lib/dispute-eligibility.ts");
  const disputesApi = read("app/api/disputes/route.ts");
  const matchApi = read("app/api/matches/[id]/route.ts");
  check(disputesApi.includes("evaluateDisputeEligibility"), "the dispute creation uses the shared eligibility rule");
  check(matchApi.includes("evaluateDisputeEligibility"), "the match details use the same eligibility rule for the dispute button");
  check(eligibility.includes('status !== "FINISHED"'), "the dispute rule requires a finished match");
  check(eligibility.includes("DUPLICATE_DISPUTE"), "the dispute rule blocks a duplicate dispute");
  const matchPage = read("app/matches/[id]/page.tsx");
  check(matchPage.includes("disputeEligibility?.canOpen"), "the dispute button is rendered from the server decision");
  check(read("app/api/disputes/route.ts").includes("match: { OR: [{ playerOneId"), "a dispute is visible to both participants");
}

// ---------------------------------------------------------------------------
// 8. Images
// ---------------------------------------------------------------------------
{
  check(exists("scripts/test-image-asset-integrity.mjs"), "the image integrity audit exists");
  const { execFileSync } = await import("node:child_process");
  const output = execFileSync(process.execPath, ["scripts/test-image-asset-integrity.mjs"], { encoding: "utf8" });
  check(output.includes("Summary: 0 FAIL"), "every local image matches its extension and every referenced path exists");
  const { heroBackgroundImage, heroBackgroundOptions } = await import(pathToFileURL(`${root}/lib/hero-backgrounds.ts`));
  for (const option of heroBackgroundOptions()) {
    check(exists(path.join("public", option.image.replace(/^\//, ""))), `${option.id} resolves to an existing file`);
  }
  check(heroBackgroundImage("hero-07").endsWith(".webp"), "the hero that ships as WebP resolves to the WebP file");
  check(heroBackgroundImage("unknown-hero") === heroBackgroundImage("hero-01"), "an unknown hero id falls back to the default hero");
  check(read("lib/duel-maps.ts").includes("/images/maps/aim_dust2.png"), "the aim dust2 catalogue entry points at the PNG asset");
}

console.log(`DuelPlay eight-task regression checks: ${checks} PASS`);
