import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(`${process.cwd()}/${p}`, "utf8");

const friends = read("app/api/friends/route.ts");
const messages = read("app/api/messages/route.ts");
const socialPage = read("app/social/page.tsx");
const header = read("components/Header/Header.tsx");
const notifications = read("app/notifications/page.tsx");

// ---------------------------------------------------------------------------
// 1. Friend accept/decline must be idempotent and must not 404 on retries.
// ---------------------------------------------------------------------------
assert.match(
  friends,
  /if \(existing\?\.status === "ACCEPTED"\) \{[\s\S]{0,220}return \{ kind: "existing", row: existing \};/,
  "accept on an already-accepted relationship returns success instead of REQUEST_NOT_FOUND",
);
assert.match(
  friends,
  /if \(action === "decline"\) \{[\s\S]{0,700}if \(!incoming \|\| incoming\.status !== "PENDING"\) return \{ kind: "declined", row: null \};/,
  "decline of an already-answered request is an idempotent no-op instead of a 404",
);
assert.match(friends, /async function settleFriendRequestNotifications/, "answering a request settles its notification in the same transaction");
assert.match(
  friends,
  /data: \{ status: "ARCHIVED", readAt: new Date\(\) \}/,
  "the answered friend-request notification is archived (read + removed from active requests)",
);
assert.match(
  friends,
  /payload: \{ path: \["kind"\], equals: "FRIEND_REQUEST" \}[\s\S]{0,120}payload: \{ path: \["senderId"\], equals: senderId \}/,
  "only the specific sender's friend-request notification is settled",
);
assert.equal(
  [...friends.matchAll(/await settleFriendRequestNotifications\(tx, me\.id, incoming\.senderId\);/g)].length,
  4,
  "accept and decline (answered and already-answered paths) all settle the originating notification",
);

// ---------------------------------------------------------------------------
// 2. Private conversations: read state is per conversation, never global.
// ---------------------------------------------------------------------------
assert.match(
  messages,
  /const fromUserId = String\(b\.fromUserId \|\| ""\)\.trim\(\)/,
  "the messages API accepts an explicit fromUserId to mark one conversation read",
);
assert.match(
  messages,
  /where: \{ receiverId: me\.id, senderId: fromUserId, readAt: null \}/,
  "marking read is scoped to a single sender",
);
assert.match(
  socialPage,
  /body:JSON\.stringify\(\{fromUserId:id\}\)/,
  "opening a chat marks only that conversation read (no global mark-all)",
);
assert.doesNotMatch(socialPage, /body:JSON\.stringify\(\{all:true\}\)/, "the social page no longer marks every conversation read");
assert.match(
  socialPage,
  /new URLSearchParams\(window\.location\.search\)\.get\("chat"\)/,
  "the social page opens a conversation from a ?chat=<userId> deep link",
);
assert.match(messages, /senderNickname: me\.nickname/, "message notifications carry the sender nickname for the bell/page copy");

// ---------------------------------------------------------------------------
// 3. Message notifications are readable and lead to the conversation.
// ---------------------------------------------------------------------------
assert.match(header, /if\(kind==="SOCIAL_MESSAGE"\)/, "the bell renders a real title for message notifications");
assert.match(header, /New message from \$\{who\}/, "the bell message body names the sender");
assert.match(header, /social\?chat=\$\{encodeURIComponent\(mid\)\}/, "the bell offers a Reply link into the conversation");
assert.match(header, /reply:"Ответить"[\s\S]*reply:"Відповісти"[\s\S]*reply:"Reply"[\s\S]*reply:"Odpowiedz"/, "the Reply label is localized in RU/UA/EN/PL");

assert.match(notifications, /kind==="SOCIAL_MESSAGE"/, "the notifications page recognizes message notifications");
assert.match(notifications, /href=\{`\/social\?chat=\$\{encodeURIComponent\(String\(n\.payload\?\.senderId\|\|""\)\)\}`\}/, "message notifications link to the correct conversation");

// ---------------------------------------------------------------------------
// 4. Accept/decline in the bell is resilient: result-agnostic, optimistic, resync.
// ---------------------------------------------------------------------------
assert.match(
  header,
  /setNotices\(v=>v\.map\(n=>n\.payload\?\.kind==="FRIEND_REQUEST"&&String\(n\.payload\?\.senderId\|\|""\)===userId\?\{\.\.\.n,status:"READ"\}:n\)\)/,
  "accept/decline optimistically clears the handled request in the bell",
);
assert.match(header, /await loadNotices\(\)[\s\S]{0,160}duelplay:notifications-updated/, "the bell resyncs and notifies other surfaces after answering");

console.log("Friends idempotency, per-conversation read state, and message notifications: PASS");
