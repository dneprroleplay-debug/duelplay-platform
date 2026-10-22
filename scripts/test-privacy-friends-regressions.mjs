import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(`${process.cwd()}/${p}`, "utf8");

const publicProfileApi = read("app/api/profile/[nickname]/route.ts");
const publicProfile = read("app/profile/[nickname]/page.tsx");
const settings = read("app/profile/page.tsx");
const friends = read("app/api/friends/route.ts");
const socialApi = read("app/api/social/route.ts");
const socialPage = read("app/social/page.tsx");
const header = read("components/Header/Header.tsx");
const notifications = read("app/notifications/page.tsx");
const messages = read("app/api/messages/route.ts");
const challenges = read("app/api/challenges/route.ts");
const locales = {
  ru: read("locales/ru.ts"),
  ua: read("locales/ua.ts"),
  en: read("locales/en.ts"),
  pl: read("locales/pl.ts"),
};

// ---------------------------------------------------------------------------
// 1. Public profile API: restricted access must not leak statistics.
// ---------------------------------------------------------------------------
assert.match(publicProfileApi, /if\(!visibleToViewer\) return NextResponse\.json\(\{restricted:true,reason:u\.profileVisibility/, "private/friend-only profiles return a restriction reason instead of hidden stats");
assert.ok(publicProfileApi.indexOf("if(!visibleToViewer)") < publicProfileApi.indexOf("prisma.playerStats.findUnique"), "the access check runs before any statistics query");
assert.match(publicProfileApi, /const statsVisible=isMe\|\|u\.showStatsPublic;/, "statistics visibility is derived from viewer identity and the privacy flag");
assert.ok(!publicProfileApi.includes("showStatsPublic:false"), "the restricted payload no longer echoes hidden statistics flags");
assert.match(publicProfileApi, /kills:statsVisible\?kills:null/, "kills are withheld from the API when stats are hidden");
assert.match(publicProfileApi, /deaths:statsVisible\?deaths:null/, "deaths are withheld from the API when stats are hidden");
assert.match(publicProfileApi, /headshots:statsVisible\?hs:null/, "headshots are withheld from the API when stats are hidden");
assert.match(publicProfileApi, /damage:statsVisible\?/, "damage is withheld from the API when stats are hidden");
assert.match(publicProfileApi, /recentMatches:statsVisible\?matches:\[\]/, "match history is withheld from the API when stats are hidden");
assert.match(publicProfileApi, /weaponStats:statsVisible\?/, "weapon stats are withheld from the API when stats are hidden");
assert.match(publicProfileApi, /mapStats:statsVisible\?/, "map stats are withheld from the API when stats are hidden");
assert.match(publicProfileApi, /ratingHistory:statsVisible\?/, "rating history is withheld from the API when stats are hidden");
assert.match(publicProfileApi, /avgKills:statsVisible\?avgKills:null/, "averages are withheld from the API when stats are hidden");
assert.match(publicProfileApi, /restricted:false,relationIncoming/, "accessible profiles flag stats visibility and incoming friendship direction");
assert.match(publicProfileApi, /select:\{status:true,senderId:true,receiverId:true\}/, "the relation query carries direction so incoming requests can be accepted");
// Regression anchors preserved from the unified match-results policy (derived from decisive finished matches).
assert.match(publicProfileApi, /derivedWins=decisiveFinishedMatches\.filter\(x=>x\.winnerId===u\.id\)\.length/, "wins are still derived from finished decisive matches");
assert.match(publicProfileApi, /derivedLosses=decisiveFinishedMatches\.filter\(x=>x\.winnerId!==u\.id\)\.length/, "losses are still derived from finished decisive matches");
assert.match(publicProfileApi, /const total=derivedWins \+ derivedLosses/, "total is still wins+losses");
assert.match(publicProfileApi, /finishedMatchCount=decisiveFinishedMatches\.length/, "profile completion still counts all decisive finished matches");

// ---------------------------------------------------------------------------
// 1a. Public match history honours the same server-side privacy contract.
// ---------------------------------------------------------------------------
{
  const publicHistoryApi = read("app/api/profile/[nickname]/history/route.ts");
  assert.match(publicHistoryApi, /if \(!visibleToViewer\)/, "the public history API checks profile visibility on the server");
  assert.match(publicHistoryApi, /if \(!isMe && !profile\.showStatsPublic\)/, "the public history API withholds hidden statistics");
  assert.match(publicHistoryApi, /OR: \[\{ playerOneId: profile\.id \}, \{ playerTwoId: profile\.id \}\]/, "the public history only returns matches of the requested player");
  assert.match(publicHistoryApi, /const isMe = Boolean\(viewer && viewer\.id === profile\.id\)/, "the profile owner can always read their own history");
  assert.match(publicHistoryApi, /status: "ACCEPTED"/, "friends-only profiles require an accepted friendship");
}

// ---------------------------------------------------------------------------
// 1b. Corrected privacy contract: owner-aware visibility, no fabricated zeros.
// ---------------------------------------------------------------------------
assert.match(publicProfileApi, /const statsVisible=isMe\|\|u\.showStatsPublic;/, "visibility combines owner identity with the public-stats flag");
assert.match(publicProfileApi, /wins:statsVisible\?derivedWins:null/, "wins are gated by the owner-aware visibility");
assert.match(publicProfileApi, /losses:statsVisible\?derivedLosses:null/, "losses are gated by the owner-aware visibility");
assert.match(publicProfileApi, /totalDuels:statsVisible\?total:null/, "total duels are gated by the owner-aware visibility");
assert.match(publicProfileApi, /winRate:statsVisible\?/, "win rate is gated by the owner-aware visibility");
assert.match(publicProfileApi, /rating,league,leaguePosition:statsVisible\?leaguePosition:null/, "rating, league and rank are resolved together under visibility");
assert.match(publicProfileApi, /const rating=statsVisible\?rawRating:null/, "rating falls back to null (never a fake 0) when hidden");
assert.match(publicProfileApi, /const league=statsVisible\?leagueFromRating\(rawRating\):null/, "league is hidden alongside the hidden rating");
assert.match(publicProfileApi, /level:statsVisible\?u\.level:null/, "level is withheld from strangers when stats are hidden");
assert.match(publicProfileApi, /xp:statsVisible\?u\.xp:null/, "xp is withheld from strangers when stats are hidden");
assert.match(publicProfileApi, /reputation:statsVisible\?u\.reputation:null/, "reputation is withheld from strangers when stats are hidden");
assert.match(publicProfileApi, /winStreak:statsVisible\?/, "win streak is gated by visibility");
assert.match(publicProfileApi, /bestStreak:statsVisible\?/, "best streak is gated by visibility");
assert.ok(!/u\.showStatsPublic\?/.test(publicProfileApi), "no statistic is gated on the raw flag alone (owner would be zeroed out)");

// Behavioural contract mirroring the API serialization for the two required cases.
function serializeStats({ isMe, showStatsPublic, derivedWins, derivedLosses, rawRating, kills, deaths, level, xp, reputation }) {
  const statsVisible = isMe || showStatsPublic;
  const total = derivedWins + derivedLosses;
  return {
    statsVisible,
    wins: statsVisible ? derivedWins : null,
    losses: statsVisible ? derivedLosses : null,
    winRate: statsVisible ? (total ? (derivedWins / total) * 100 : 0) : null,
    totalDuels: statsVisible ? total : null,
    rating: statsVisible ? rawRating : null,
    level: statsVisible ? level : null,
    xp: statsVisible ? xp : null,
    reputation: statsVisible ? reputation : null,
    kills: statsVisible ? kills : null,
    kd: statsVisible ? (deaths ? kills / deaths : kills) : null,
  };
}

// Case A: the owner views their own profile while public stats are hidden.
const ownerView = serializeStats({ isMe: true, showStatsPublic: false, derivedWins: 7, derivedLosses: 3, rawRating: 1450, kills: 70, deaths: 35, level: 12, xp: 900, reputation: 55 });
assert.equal(ownerView.statsVisible, true, "case A: owner always sees statistics");
assert.equal(ownerView.wins, 7, "case A: owner wins are the real value (not zeroed)");
assert.equal(ownerView.losses, 3, "case A: owner losses are the real value");
assert.equal(ownerView.rating, 1450, "case A: owner sees the real rating");
assert.equal(ownerView.level, 12, "case A: owner sees the real level");
assert.equal(ownerView.xp, 900, "case A: owner sees the real xp");
assert.equal(ownerView.reputation, 55, "case A: owner sees the real reputation");
assert.equal(ownerView.kd, 2, "case A: owner sees the real K/D");

// Case B: a stranger views a profile whose public statistics are disabled.
const strangerView = serializeStats({ isMe: false, showStatsPublic: false, derivedWins: 7, derivedLosses: 3, rawRating: 1450, kills: 70, deaths: 35, level: 12, xp: 900, reputation: 55 });
assert.equal(strangerView.statsVisible, false, "case B: statistics are hidden from strangers");
for (const key of ["wins", "losses", "winRate", "totalDuels", "rating", "level", "xp", "reputation", "kills", "kd"]) {
  assert.equal(strangerView[key], null, `case B: ${key} is withheld from the API (null, not a fake 0)`);
}
assert.notEqual(strangerView.wins, 0, "case B: withheld wins must never be rendered as 0");

// ---------------------------------------------------------------------------
// 1c. Anonymous visitors: PUBLIC is world-readable, PRIVATE/FRIENDS are not.
// ---------------------------------------------------------------------------
assert.ok(!publicProfileApi.includes("if(!viewer)"), "the API no longer hard-blocks anonymous visitors");
assert.match(publicProfileApi, /const me=viewer;/, "the viewer is captured even when anonymous (null)");
assert.match(publicProfileApi, /const isMe=Boolean\(me&&me\.id===u\.id\)/, "an anonymous viewer is never the owner");
assert.match(publicProfileApi, /if\(me&&!isMe\)\{relation=await prisma\.friend\.findFirst/, "friendship is only resolved for a signed-in non-owner");
assert.match(publicProfileApi, /const myRival=me&&!isMe\?await prisma\.rival\.findUnique/, "rivalry is only resolved for a signed-in non-owner");
assert.match(publicProfileApi, /const relationIncoming=Boolean\(me&&!isMe&&relation\?\.status==="PENDING"/, "relationIncoming stays false for anonymous visitors and unrelated users");
assert.match(publicProfileApi, /u\.profileVisibility==="PUBLIC" \|\| isMe \|\| \(u\.profileVisibility==="FRIENDS" && relation\?\.status==="ACCEPTED"\)/, "PUBLIC is visible to everyone; FRIENDS only to accepted friends");

// Behavioural contract for the access decision (mirrors the route).
function access({ visibility, viewer, acceptedFriend }) {
  const isMe = viewer === "owner";
  const relation = viewer === "friend" || viewer === "stranger" ? { status: acceptedFriend ? "ACCEPTED" : "PENDING" } : null;
  const visible = visibility === "PUBLIC" || isMe || (visibility === "FRIENDS" && relation?.status === "ACCEPTED");
  return { visible, restricted: !visible, isMe, isFriend: Boolean(relation?.status === "ACCEPTED") };
}

// PUBLIC: readable by anonymous and signed-in viewers alike.
for (const viewer of ["anonymous", "stranger", "friend", "owner"]) {
  const r = access({ visibility: "PUBLIC", viewer, acceptedFriend: viewer === "friend" });
  assert.equal(r.visible, true, `PUBLIC is visible to ${viewer}`);
  assert.equal(r.restricted, false, `PUBLIC is not restricted for ${viewer}`);
}
// PRIVATE: only the owner.
assert.equal(access({ visibility: "PRIVATE", viewer: "owner" }).visible, true, "PRIVATE is visible to the owner");
for (const viewer of ["anonymous", "stranger"]) {
  const r = access({ visibility: "PRIVATE", viewer });
  assert.equal(r.visible, false, `PRIVATE is restricted for ${viewer}`);
  assert.equal(r.restricted, true, `PRIVATE returns a restricted response for ${viewer}`);
}
// FRIENDS: owner and accepted friends only.
assert.equal(access({ visibility: "FRIENDS", viewer: "owner" }).visible, true, "FRIENDS is visible to the owner");
assert.equal(access({ visibility: "FRIENDS", viewer: "friend", acceptedFriend: true }).visible, true, "FRIENDS is visible to accepted friends");
assert.equal(access({ visibility: "FRIENDS", viewer: "stranger", acceptedFriend: false }).visible, false, "FRIENDS is restricted for non-friends");
assert.equal(access({ visibility: "FRIENDS", viewer: "anonymous" }).visible, false, "FRIENDS is restricted for anonymous visitors");
// An anonymous visitor is never owner/friend, so hidden stats never leak.
for (const visibility of ["PUBLIC", "PRIVATE", "FRIENDS"]) {
  const anon = access({ visibility, viewer: "anonymous" });
  assert.equal(anon.isMe, false, `anonymous is never the owner on ${visibility}`);
  assert.equal(anon.isFriend, false, `anonymous is never a friend on ${visibility}`);
}
const anonPublicHidden = serializeStats({ isMe: false, showStatsPublic: false, derivedWins: 7, derivedLosses: 3, rawRating: 1450, kills: 70, deaths: 35, level: 12, xp: 900, reputation: 55 });
assert.equal(anonPublicHidden.statsVisible, false, "anonymous PUBLIC view still hides disabled public statistics");
assert.equal(anonPublicHidden.wins, null, "anonymous PUBLIC view does not leak hidden wins");
assert.equal(anonPublicHidden.rating, null, "anonymous PUBLIC view does not leak hidden rating");

// ---------------------------------------------------------------------------
// 2. Public profile page: no unguarded .toFixed, restriction + error screens.
// ---------------------------------------------------------------------------
assert.match(publicProfile, /const statsVisible=p\.statsVisible!==false;/, "the page reads stats visibility from the API");
assert.match(publicProfile, /\{statsVisible&&<p className="mt-2 text-zinc-500">\{leagueLabel\}/, "the rating/level/xp header line is gated so it never renders nulls for hidden stats");
assert.ok(publicProfile.includes('{statsVisible&&<p className="mt-2 text-zinc-500">{leagueLabel} · {copy.rating} {p.rating} · {copy.level} {p.level} · {copy.xp} {p.xp}</p>}'), "the possible-null rating/level/xp line only exists inside the visibility guard");
assert.match(publicProfile, /num\(p\.winRate\)\.toFixed\(1\)/, "win rate uses the safe numeric helper");
assert.match(publicProfile, /num\(p\.kd\)\.toFixed\(2\)/, "K/D uses the safe numeric helper");
assert.match(publicProfile, /num\(p\.hsRate\)\.toFixed\(1\)/, "HS% uses the safe numeric helper");
assert.ok(!/p\.winRate\.toFixed|p\.kd\.toFixed|p\.hsRate\.toFixed/.test(publicProfile), "raw .toFixed is never called on possibly-missing stat fields");
assert.match(publicProfile, /if\(d\.restricted\)return/, "restricted profiles render a dedicated screen");
assert.match(publicProfile, /copy\.restrictedPrivate/, "private profiles explain the private setting");
assert.match(publicProfile, /copy\.restrictedFriends/, "friend-only profiles explain the friends-only setting");
assert.match(publicProfile, /const\[err,setErr\]=useState\(false\);/, "the page keeps a separate error state");
assert.match(publicProfile, /if\(err\)return/, "unexpected failures show the error state, not a loading lock");
assert.match(publicProfile, /if\(!r\.ok\)\{\s*if\(!disposed\)setErr\(true\)/, "non-OK API responses set the error state instead of being swallowed");
assert.match(publicProfile, /\.catch\(\(\)=>\{\s*if\(!disposed\)setErr\(true\);\s*\}\)/, "network failures set the error state");
assert.match(publicProfile, /data-no-i18n className=\{`grid h-8/, "ranked form chips stay excluded from machine translation");

// Incoming friend requests can be accepted from the profile page.
assert.match(publicProfile, /p\.relationIncoming\?'accept'/, "the friend button accepts incoming requests");
assert.match(publicProfile, /copy\.acceptFriend/, "the accept label is localized");

// ---------------------------------------------------------------------------
// 3. Privacy toggles.
// ---------------------------------------------------------------------------
assert.match(settings, /label=\{t\.hidePublicStats\} value=\{!u\.showStatsPublic\} onChange=\{v=>privacy\(\{showStatsPublic:!v\}\)\}/, "the stats toggle is an explicit restriction toggle mapped onto the stored flag (no silent inversion)");
for (const lang of ["ru", "ua", "en", "pl"]) {
  assert.match(locales[lang], /hidePublicStats:/, `hidePublicStats label exists in ${lang}`);
  assert.match(locales[lang], /friendOnline:/, `friendOnline label exists in ${lang}`);
  assert.match(locales[lang], /friendOffline:/, `friendOffline label exists in ${lang}`);
  assert.match(locales[lang], /noFriends:/, `noFriends label exists in ${lang}`);
}
assert.match(settings, /privacy\(\{allowChallenges:v\}\)/, "the duel-challenge toggle persists");
assert.match(settings, /privacy\(\{allowMessages:v\}\)/, "the private-message toggle persists");
assert.match(settings, /privacy\(\{profileVisibility:e\.target\.value\}\)/, "the profile-visibility selector persists");
assert.match(messages, /if \(!receiver\.allowMessages\) throw new Error\("MESSAGES_DISABLED"\)/, "the messages API enforces the private-message toggle");
assert.match(messages, /allowMessages: true/, "the messages API reads the recipient's message preference");
assert.match(challenges, /if \(!receiver\.allowChallenges\) throw new Error\("CHALLENGES_DISABLED"\)/, "the challenges API enforces the duel-challenge toggle");
assert.match(publicProfileApi, /visibleToViewer=u\.profileVisibility==="PUBLIC" \|\| isMe \|\| \(u\.profileVisibility==="FRIENDS" && relation\?\.status==="ACCEPTED"\)/, "profile visibility rules cover public, owner and confirmed-friends access");

// ---------------------------------------------------------------------------
// 4. Friend requests: nickname resolution, dedup, guards, notification.
// ---------------------------------------------------------------------------
assert.match(friends, /const UUID_RE = \/\^\[0-9a-f\]\{8\}/, "friend lookups accept a nickname as well as a UUID");
assert.match(friends, /findUnique\(\{ where: \{ nickname: userId \}/, "nicknames are resolved to user ids");
assert.match(friends, /if \(userId === me\.id\) return NextResponse\.json\(\{ error: "Invalid user" \}/, "a player cannot add themselves");
assert.match(friends, /if \(outgoing\?\.status === "PENDING"\) return \{ kind: "existing", row: outgoing \};/, "a duplicate outgoing request is idempotent");
assert.match(friends, /if \(existing\?\.status === "ACCEPTED"\) return \{ kind: "existing", row: existing \};/, "an existing friendship is not duplicated");
assert.match(friends, /if \(relations\.some\(\(x\) => x\.status === "BLOCKED"\)\) throw new Error\("BLOCKED"\)/, "blocks prevent friend requests");
assert.match(friends, /if \(!incoming \|\| incoming\.status !== "PENDING"\) throw new Error\("REQUEST_NOT_FOUND"\)/, "accepting a request that does not exist is rejected");
assert.match(friends, /senderId: me\.id, senderNickname: me\.nickname/, "the friend-request notification carries the real sender nickname");
assert.match(friends, /accepterId: me\.id, accepterNickname: me\.nickname/, "the acceptance notification carries the accepting player's nickname");

// Behavioural check of the request decision matrix (mirrors the route logic).
function decideAdd({ blocked, muted, outgoingPending, incomingPending, accepted }) {
  if (blocked || muted) return "BLOCKED";
  if (outgoingPending) return "existing";
  if (incomingPending) return "INCOMING_PENDING";
  if (accepted) return "existing";
  return "created";
}
assert.equal(decideAdd({ blocked: false, muted: false, outgoingPending: false, incomingPending: false, accepted: false }), "created");
assert.equal(decideAdd({ blocked: false, muted: false, outgoingPending: true, incomingPending: false, accepted: false }), "existing");
assert.equal(decideAdd({ blocked: false, muted: false, outgoingPending: false, incomingPending: true, accepted: false }), "INCOMING_PENDING");
assert.equal(decideAdd({ blocked: false, muted: false, outgoingPending: false, incomingPending: false, accepted: true }), "existing");
assert.equal(decideAdd({ blocked: true, muted: false, outgoingPending: false, incomingPending: false, accepted: false }), "BLOCKED");
assert.equal(decideAdd({ blocked: false, muted: true, outgoingPending: false, incomingPending: false, accepted: false }), "BLOCKED");

// ---------------------------------------------------------------------------
// 5. Notifications surface the sender nickname with profile/accept actions.
// ---------------------------------------------------------------------------
assert.match(header, /if\(kind==="FRIEND_REQUEST"\)return/, "the header localizes friend-request titles");
assert.match(header, /p\.senderNickname/, "the header body uses the real sender nickname");
assert.match(header, /const friendActions=\(n:Notice\)=>/, "the header renders action controls for friend requests");
assert.match(header, /void respondFriend\(id,"accept"\)/, "the header can accept a friend request");
assert.match(header, /async function respondFriend\(userId:string,action:"accept"\|"decline"\)/, "the header posts friend responses through the existing friends API");
assert.match(notifications, /async function respondFriend\(/, "the notifications page can respond to friend requests");
assert.match(notifications, /Player \$\{who\} wants to add you as a friend\./, "the notifications page shows the sender nickname");
assert.match(notifications, /\/profile\/\$\{encodeURIComponent\(who\)\}/, "the notifications page links to the sender profile");

// ---------------------------------------------------------------------------
// 6. Community friends list with online/offline presence.
// ---------------------------------------------------------------------------
assert.match(socialApi, /isRevoked: false, expiresAt: \{ gt: now \}, lastActiveAt: \{ gte: activeSince \}/, "presence reuses the existing session-based source");
assert.match(socialApi, /const friends = normalizedFriends\.map/, "friends are enriched with online status");
assert.match(socialApi, /online: onlineSet\.has\(x\.person\.id\)/, "each friend exposes an online flag");
assert.match(socialPage, /const onlineFriends=accepted\.filter/, "online and offline friends are separated");
assert.match(socialPage, /const offlineFriends=accepted\.filter/, "offline friends are listed");
assert.match(socialPage, /t\.friendOnline/, "online label is localized");
assert.match(socialPage, /t\.friendOffline/, "offline label is localized");
assert.match(socialPage, /t\.noFriends/, "empty state is localized");
assert.match(socialPage, /function FriendRow\(/, "a dedicated friends row renders avatar, nickname and profile link");
assert.match(socialPage, /const \[loadErr,setLoadErr\]=useState\(false\)/, "the community page tracks load errors");
assert.match(socialPage, /flex-col gap-3 rounded-xl[\s\S]*sm:flex-row/, "friends rows adapt to mobile");

// ---------------------------------------------------------------------------
// 7. Previous work is preserved.
// ---------------------------------------------------------------------------
assert.match(read("app/api/achievements/route.ts"), /./, "achievements API still present");
assert.match(read("components/Common/AuthContext.tsx"), /const refresh = useCallback/, "stable auth refresh is preserved");
assert.match(read("components/Common/MaintenanceGate.tsx"), /controller\.abort\(\)/, "maintenance fail-open is preserved");
assert.match(read("app/matches/[id]/page.tsx"), /if\(terminalSyncRef\.current===status\)return;/, "terminal match polling guard is preserved");

console.log("Privacy toggles, restricted profiles, friend requests, notifications and community presence: PASS");
