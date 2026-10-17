import assert from "node:assert/strict";
import fs from "node:fs";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// UNIT / STUB TEST — NOT AN INTEGRATION TEST.
//
// `GET /api/matches` is imported directly and executed against an in-memory
// Prisma stub. No database, Docker or network connection is used, so this file
// proves the route's *filtering contract*, not end-to-end behaviour against
// PostgreSQL. The only true integration harness in this repo is the opt-in
// `scripts/test-demo-wallet-postgres.integration.mjs` (requires Docker) and it
// is intentionally not run here.
//
// What the stub verifies:
//   * `mine=active` stays reachable for the owner across every non-terminal
//     lifecycle state (WAITING_FOR_PLAYERS / READY / STARTING / LIVE) and for
//     both economies, even when no `economyMode` is supplied.
//   * terminal matches (CREATING / FINISHED / CANCELLED / DISPUTED) are never
//     surfaced as an active duel.
//   * an explicit `economyMode=REAL|DEMO` filter is still honoured, and the
//     public list keeps its historical REAL-by-default behaviour.
//   * the owner's match is found whether they are playerOne or playerTwo, and
//     the payload keeps the id + deadline fields the return UI needs.
//
// Deadlines: the route is status-driven, so a non-terminal match whose timer
// has elapsed is still returned for the player to see; transitioning it to a
// terminal state is the watchdog's job and is out of scope for this unit test.
// ---------------------------------------------------------------------------

const root = process.cwd();

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve(pathToFileURL(`${root}/node_modules/next/server.js`).href, context);
    if (specifier === "next/headers") return nextResolve(pathToFileURL(`${root}/node_modules/next/headers.js`).href, context);
    if (specifier === "@/lib/prisma") {
      return { url: `data:text/javascript,${encodeURIComponent("export const prisma = globalThis.__TEST_PRISMA__;")}`, shortCircuit: true };
    }
    if (specifier === "@/lib/current-user") {
      return { url: `data:text/javascript,${encodeURIComponent("export async function getCurrentUser(){ return globalThis.__TEST_USER__ ?? null; } export async function getCurrentSession(){ return null; }")}`, shortCircuit: true };
    }
    if (specifier.startsWith("@/lib/")) return nextResolve(pathToFileURL(`${root}/lib/${specifier.slice(6)}.ts`).href, context);
    return nextResolve(specifier, context);
  },
});

function rowMatches(row, where) {
  if (!where) return true;
  if (where.status !== undefined) {
    if (typeof where.status === "string" && row.status !== where.status) return false;
    if (Array.isArray(where.status.in) && !where.status.in.includes(row.status)) return false;
  }
  if (where.economyMode !== undefined && row.economyMode !== where.economyMode) return false;
  if (where.playerOneId !== undefined && row.playerOneId !== where.playerOneId) return false;
  if (where.playerTwoId !== undefined && row.playerTwoId !== where.playerTwoId) return false;
  if (Array.isArray(where.OR) && !where.OR.some(clause => rowMatches(row, clause))) return false;
  if (Array.isArray(where.AND) && !where.AND.every(clause => rowMatches(row, clause))) return false;
  return true;
}

let lastWhere = null;
globalThis.__TEST_PRISMA__ = {
  match: {
    async findFirst({ where }) {
      lastWhere = where;
      const rows = globalThis.__TEST_ROWS__ ?? [];
      return rows.find(row => rowMatches(row, where)) ?? null;
    },
    async findMany({ where }) {
      lastWhere = where;
      const rows = globalThis.__TEST_ROWS__ ?? [];
      return rows.filter(row => rowMatches(row, where));
    },
  },
};

const route = await import("../app/api/matches/route.ts");
const { NextRequest } = await import("next/server");

function get(query) {
  return route.GET(new NextRequest(`http://duelplay.test/api/matches${query}`));
}
async function mineMatch(query = "") {
  const res = await get(`?mine=active${query}`);
  return { status: res.status, body: await res.json() };
}

const owner = { id: "user-1", nickname: "user-1", role: "USER" };
globalThis.__TEST_USER__ = owner;

function matchFor(status, overrides = {}) {
  return {
    id: `m-${status.toLowerCase()}`,
    status,
    economyMode: "DEMO",
    mapName: "Mirage",
    mode: "SOLO_1V1",
    weaponModifier: null,
    betAmount: "100",
    playerOneId: "user-1",
    playerTwoId: "user-2",
    startedAt: null,
    startDeadlineAt: null,
    liveDeadlineAt: null,
    connectionPhaseCompleted: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Anonymous callers never receive an active duel.
// ---------------------------------------------------------------------------
globalThis.__TEST_USER__ = null;
globalThis.__TEST_ROWS__ = [matchFor("LIVE")];
assert.deepEqual((await mineMatch()).body, { active: false, match: null }, "anonymous callers get no active match");
globalThis.__TEST_USER__ = owner;

// ---------------------------------------------------------------------------
// 2. Every non-terminal status is surfaced, in either economy, with no filter.
//    Each case also confirms the seen match is the owner's own id.
// ---------------------------------------------------------------------------
for (const status of ["WAITING_FOR_PLAYERS", "READY", "STARTING", "LIVE"]) {
  globalThis.__TEST_ROWS__ = [matchFor(status)];
  const { body } = await mineMatch();
  assert.equal(body.active, true, `mine=active (no economy) finds a ${status} match`);
  assert.equal(body.match.status, status, `the returned match keeps its ${status} status`);
  assert.equal(body.match.id, `m-${status.toLowerCase()}`, `the ${status} match is returned by id for re-entry`);
  assert.deepEqual(lastWhere.status.in, ["WAITING_FOR_PLAYERS", "READY", "STARTING", "LIVE"], "active lookup spans every non-terminal status");
  assert.equal(lastWhere.economyMode, undefined, `no economy filter is applied for ${status} without a parameter`);
}

// ---------------------------------------------------------------------------
// 3. Terminal matches are never returned as an active duel.
// ---------------------------------------------------------------------------
for (const status of ["CREATING", "FINISHED", "CANCELLED", "DISPUTED"]) {
  globalThis.__TEST_ROWS__ = [matchFor(status)];
  const { body } = await mineMatch();
  assert.equal(body.active, false, `a ${status} match is not offered as an active duel`);
  assert.equal(body.match, null, `a ${status} match payload is null`);
}

// ---------------------------------------------------------------------------
// 4. Timer/deadline handling: the route is status-driven. A non-terminal match
//    whose deadline already elapsed is still returned (terminalization belongs
//    to the watchdog), and the deadline fields are exposed for the UI.
// ---------------------------------------------------------------------------
const past = new Date(Date.now() - 60_000).toISOString();
globalThis.__TEST_ROWS__ = [matchFor("STARTING", { startDeadlineAt: past })];
let { body } = await mineMatch();
assert.equal(body.active, true, "a STARTING match past its start deadline is still surfaced for the player");
assert.equal(body.match.startDeadlineAt, past, "the start deadline is exposed so the UI can show expiry");

globalThis.__TEST_ROWS__ = [matchFor("LIVE", { liveDeadlineAt: past })];
({ body } = await mineMatch());
assert.equal(body.active, true, "a LIVE match past its live deadline is still surfaced for the player");
assert.equal(body.match.liveDeadlineAt, past, "the live deadline is exposed so the UI can show expiry");
assert.ok("startedAt" in body.match && "connectionPhaseCompleted" in body.match, "lifecycle fields expected by the return UI are present");

// ---------------------------------------------------------------------------
// 5. REAL/DEMO separation for the OWNER lookup.
// ---------------------------------------------------------------------------
const demoLive = matchFor("LIVE", { id: "demo-live", economyMode: "DEMO" });
const realReady = matchFor("READY", { id: "real-ready", economyMode: "REAL", playerTwoId: null });

// No filter: both economies are eligible (list has REAL first to prove the DEMO case is not just ordering).
globalThis.__TEST_ROWS__ = [realReady, demoLive];
({ body } = await mineMatch());
assert.equal(body.active, true, "no economy filter finds an active match across economies");
assert.ok(["demo-live", "real-ready"].includes(body.match.id));

// Explicit REAL only sees REAL, explicit DEMO only sees DEMO, regardless of order.
globalThis.__TEST_ROWS__ = [realReady, demoLive];
({ body } = await mineMatch("&economyMode=REAL"));
assert.equal(body.match.id, "real-ready", "explicit REAL restricts the owner lookup to REAL");
assert.equal(lastWhere.economyMode, "REAL");

globalThis.__TEST_ROWS__ = [realReady, demoLive];
({ body } = await mineMatch("&economyMode=DEMO"));
assert.equal(body.match.id, "demo-live", "explicit DEMO restricts the owner lookup to DEMO even when a REAL match exists");
assert.equal(lastWhere.economyMode, "DEMO");

// ALL behaves like no filter.
globalThis.__TEST_ROWS__ = [realReady, demoLive];
({ body } = await mineMatch("&economyMode=ALL"));
assert.equal(body.active, true, "explicit ALL finds an active match");
assert.equal(lastWhere.economyMode, undefined, "ALL removes the economy constraint");

// A DEMO-only account is findable with no parameter but invisible under REAL.
globalThis.__TEST_ROWS__ = [demoLive];
assert.equal((await mineMatch()).body.active, true, "a DEMO-only account is found without a parameter");
assert.equal((await mineMatch("&economyMode=REAL")).body.active, false, "a DEMO-only account is filtered out under explicit REAL");
assert.equal((await mineMatch("&economyMode=DEMO")).body.active, true, "a DEMO-only account is found under explicit DEMO");

// ---------------------------------------------------------------------------
// 6. Re-entry: the owner is found whether they are playerOne or playerTwo.
// ---------------------------------------------------------------------------
globalThis.__TEST_USER__ = { id: "user-2", nickname: "user-2", role: "USER" };
globalThis.__TEST_ROWS__ = [matchFor("LIVE", { id: "joined-live", playerOneId: "user-1", playerTwoId: "user-2" })];
({ body } = await mineMatch());
assert.equal(body.active, true, "the joined player (playerTwo) can also return to the match");
assert.equal(body.match.id, "joined-live");

// A match owned by neither slot is never leaked.
globalThis.__TEST_USER__ = { id: "user-99", nickname: "user-99", role: "USER" };
assert.equal((await mineMatch()).body.active, false, "another player's active match is not leaked");

// ---------------------------------------------------------------------------
// 7. Invalid economy values and the public list contract.
// ---------------------------------------------------------------------------
globalThis.__TEST_USER__ = owner;
const invalid = await get("?economyMode=FOO");
assert.equal(invalid.status, 400, "invalid economy mode is a bad request");
assert.equal((await invalid.json()).errorCode, "INVALID_ECONOMY_MODE");
assert.equal((await get("?mine=active&economyMode=FOO")).status, 400, "invalid economy mode is rejected for the owner lookup too");

const demoWaiting = matchFor("WAITING_FOR_PLAYERS", { id: "demo-waiting", economyMode: "DEMO" });
globalThis.__TEST_ROWS__ = [realReady, demoLive, demoWaiting];
assert.deepEqual((await (await get("?status=active")).json()).map(r => r.id), ["real-ready"], "the public list keeps defaulting to REAL and excludes DEMO");
assert.equal(lastWhere.economyMode, "REAL", "the public list applies the REAL economy filter by default");
// The LIVE DEMO section calls `?status=active`, so it must show READY/STARTING/LIVE
// DEMO matches and exclude DEMO matches that are still waiting for a player.
assert.deepEqual((await (await get("?status=active&economyMode=DEMO")).json()).map(r => r.id), ["demo-live"], "the LIVE DEMO section surfaces in-progress DEMO matches and hides WAITING ones");
assert.deepEqual((await (await get("?status=active&economyMode=ALL")).json()).map(r => r.id).sort(), ["demo-live", "real-ready"], "ALL returns both economies in the public list");

// ---------------------------------------------------------------------------
// 8. UI contracts: lobby return banner for every non-terminal state, the
//    dedicated LIVE DEMO section, and the creation-page re-entry banner.
// ---------------------------------------------------------------------------
const live = fs.readFileSync(`${root}/components/Live/Live.tsx`, "utf8");
assert.match(live, /activeDuelStatuses=\["WAITING_FOR_PLAYERS","READY","STARTING","LIVE"\]/, "every non-terminal status is offered as a return path");
assert.match(live, /fetch\("\/api\/matches\?mine=active",\{cache:"no-store"\}\)/, "the lobby fetches its own active match without an economy filter");
assert.match(live, /href=\{`\/matches\/\$\{myActiveMatch\.id\}`\}/, "the return banner links back to the owned match");
assert.match(live, /Return to match →/, "the LIVE-state banner offers a return-to-match action");
assert.match(live, /Your duel is live right now\./, "the LIVE-state banner is localized");
assert.match(live, /Your duel server is starting\./, "the STARTING-state banner is localized");
assert.match(live, /Your duel is waiting for a second player\./, "the WAITING-state banner is localized");
assert.match(live, /economy\?:"REAL"\|"DEMO"/, "Live accepts a fixed economy section");
assert.doesNotMatch(live, /useState<any>/, "Live no longer falls back to an untyped any state");

const livePage = fs.readFileSync(`${root}/app/live/page.tsx`, "utf8");
assert.match(livePage, /<Live mode="active" economy="REAL"\/>/, "the LIVE page renders the REAL section");
assert.match(livePage, /<Live mode="active" economy="DEMO"\/>/, "the LIVE page renders the dedicated DEMO section");

const demoCreate = fs.readFileSync(`${root}/components/CreateMatch/DemoCreateMatch.tsx`, "utf8");
assert.match(demoCreate, /fetch\("\/api\/matches\?mine=active", \{ cache: "no-store" \}\)/, "the creation page checks for an existing active duel");
assert.match(demoCreate, /activeMatch&&/, "the creation page shows the re-entry banner when an active duel exists");
assert.match(demoCreate, /disabled=\{[^}]*Boolean\(activeMatch\)/, "creating is disabled while an active duel exists");

// ---------------------------------------------------------------------------
// 9. Localization: the new RU/UA/PL/EN copy keys stay in parity and are real
//    strings (no placeholder duplication) across all four languages.
// ---------------------------------------------------------------------------
for (const [lang, title, open] of [
  ["RU", "У вас уже есть активная дуэль.", "Открыть матч →"],
  ["UA", "У вас уже є активна дуель.", "Відкрити матч →"],
  ["PL", "Masz już aktywny pojedynek.", "Otwórz mecz →"],
  ["EN", "You already have an active duel.", "Open match →"],
]) {
  assert.ok(demoCreate.includes(title), `the ${lang} re-entry title is present`);
  assert.ok(demoCreate.includes(open), `the ${lang} re-entry action is present`);
}

console.log("Active duel retrieval (stubbed unit), REAL/DEMO separation and LIVE DEMO section: PASS");
