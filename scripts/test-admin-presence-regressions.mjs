import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(`${process.cwd()}/${p}`, "utf8");

const presenceLib = read("lib/presence.ts");
const heartbeatApi = read("app/api/auth/heartbeat/route.ts");
const authContext = read("components/Common/AuthContext.tsx");
const adminUsersApi = read("app/api/admin/access/users/route.ts");
const adminUsersPresence = read("components/Admin/AdminUsersPresence.tsx");
const adminAccessPage = read("app/admin/access/page.tsx");
const socialApi = read("app/api/social/route.ts");
const realtimeApi = read("app/api/admin/realtime/route.ts");
const adminApi = read("app/api/admin/route.ts");

// ---------------------------------------------------------------------------
// 1. Unified 120s presence threshold across helper and consuming endpoints.
// ---------------------------------------------------------------------------
assert.match(
  presenceLib,
  /export const PRESENCE_THRESHOLD_MS = 120_000;/,
  "presence lib exports the unified 120,000 ms threshold",
);
assert.match(
  presenceLib,
  /export function getPresenceCutoff\(now = new Date\(\)\): Date/,
  "presence lib exports getPresenceCutoff helper",
);
assert.match(
  presenceLib,
  /export function isSessionOnline\(/,
  "presence lib exports isSessionOnline helper",
);

assert.match(
  socialApi,
  /getPresenceCutoff/,
  "social API uses unified getPresenceCutoff",
);
assert.match(
  realtimeApi,
  /getPresenceCutoff/,
  "admin realtime API uses unified getPresenceCutoff",
);
assert.match(
  adminApi,
  /getPresenceCutoff/,
  "admin metrics API uses unified getPresenceCutoff",
);

// ---------------------------------------------------------------------------
// 2. Authenticated heartbeat endpoint.
// ---------------------------------------------------------------------------
assert.match(
  heartbeatApi,
  /request\.cookies\.get\(SESSION_COOKIE\)\?\.value/,
  "heartbeat checks for authenticated session cookie",
);
assert.match(
  heartbeatApi,
  /lastActiveAt: now/,
  "heartbeat updates lastActiveAt timestamp",
);

// ---------------------------------------------------------------------------
// 3. Client heartbeat in AuthContext: visibility-aware interval.
// ---------------------------------------------------------------------------
assert.match(
  authContext,
  /35000/,
  "AuthContext pings heartbeat every 35s (within 30-45s window)",
);
assert.match(
  authContext,
  /if \(disposed \|\| document\.visibilityState === "hidden"\) return;/,
  "AuthContext avoids background heartbeat drain when tab is hidden",
);
assert.match(
  authContext,
  /fetch\("\/api\/auth\/heartbeat"/,
  "AuthContext targets /api/auth/heartbeat",
);

// ---------------------------------------------------------------------------
// 4. Admin Users Presence API: RBAC and data sanitation.
// ---------------------------------------------------------------------------
assert.match(
  adminUsersApi,
  /await requirePermission\("users\.view"\);/,
  "admin presence API enforces users.view permission via RBAC",
);
assert.match(
  adminUsersApi,
  /getPresenceCutoff\(now\)/,
  "admin presence API calculates online status using unified threshold",
);
assert.match(
  adminUsersApi,
  /contains: search,\s*mode: "insensitive"/,
  "admin presence API supports case-insensitive nickname search",
);
assert.match(
  adminUsersApi,
  /totalPages,[\s\S]*users: items/,
  "admin presence API returns sanitized pagination metadata",
);

// ---------------------------------------------------------------------------
// 5. Admin Access UI integration.
// ---------------------------------------------------------------------------
assert.match(
  adminAccessPage,
  /<AdminUsersPresence \/>/,
  "Admin access page embeds the AdminUsersPresence component",
);
assert.match(
  adminUsersPresence,
  /fetch\(`\/api\/admin\/access\/users\?/,
  "AdminUsersPresence component queries the admin users API",
);
assert.match(
  adminUsersPresence,
  /Онлайн/,
  "AdminUsersPresence displays online count tab",
);
assert.match(
  adminUsersPresence,
  /Офлайн/,
  "AdminUsersPresence displays offline count tab",
);

console.log("Admin users online/offline presence, heartbeat, and RBAC: PASS");
