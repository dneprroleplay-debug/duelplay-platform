import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(`${process.cwd()}/${p}`, "utf8");

const matchesApi = read("app/api/matches/route.ts");
const joinApi = read("app/api/matches/[id]/join/route.ts");
const live = read("components/Live/Live.tsx");

// ---------------------------------------------------------------------------
// 1. Server-side: participants retain visibility of READY matches under waiting query.
// ---------------------------------------------------------------------------
assert.match(
  matchesApi,
  /status === "waiting"[\s\S]{0,250}status: "WAITING_FOR_PLAYERS"[\s\S]{0,250}status: "READY"[\s\S]{0,250}playerOneId: user\.id[\s\S]{0,100}playerTwoId: user\.id/,
  "GET /api/matches?status=waiting allows participants to retrieve their READY match while hiding it from third players",
);

// ---------------------------------------------------------------------------
// 2. Joining transitions match to READY and notifies participants.
// ---------------------------------------------------------------------------
assert.match(
  joinApi,
  /status:\s*"READY"/,
  "successful join sets match status to READY",
);
assert.match(
  joinApi,
  /type:\s*"MATCH_READY"/,
  "successful join notifies match creator that duel is ready",
);

// ---------------------------------------------------------------------------
// 3. LIVE Lobby UI: participants see banner and launch button for READY matches.
// ---------------------------------------------------------------------------
assert.match(
  live,
  /const isParticipant=Boolean\(currentUserId&&\(match\.playerOneId===currentUserId\|\|match\.playerTwoId===currentUserId\|\|activeMatchId===match\.id\)\);/,
  "Live.tsx identifies participants of the match",
);

assert.match(
  live,
  /activeStatus&&myActiveMatch&&/,
  "Live.tsx presents a return banner for the current user's active match",
);

assert.match(
  live,
  /activeDuelStatuses=\["WAITING_FOR_PLAYERS","READY","STARTING","LIVE"\]/,
  "the return banner covers waiting, ready, starting and live matches",
);

assert.match(
  live,
  /Ваша дуэль готова! Оба игрока на месте\./,
  "ready duel banner is localized in Russian",
);

assert.match(
  live,
  /Ваша дуель готова! Обидва гравці на місці\./,
  "ready duel banner is localized in Ukrainian",
);

assert.match(
  live,
  /Your duel is ready! Both players joined\./,
  "ready duel banner is localized in English",
);

assert.match(
  live,
  /Twój pojedynek jest gotowy! Obaj gracze są na miejscu\./,
  "ready duel banner is localized in Polish",
);

assert.match(
  live,
  /href=\{`\/matches\/\$\{myActiveMatch\.id\}`\}/,
  "ready banner links directly to the duel arena",
);

assert.match(
  live,
  /href=\{`\/matches\/\$\{match\.id\}`\}/,
  "ready MatchCard participant action links directly to the duel arena",
);

console.log("DEMO and LIVE match lifecycle, participant visibility, and ready banner: PASS");
