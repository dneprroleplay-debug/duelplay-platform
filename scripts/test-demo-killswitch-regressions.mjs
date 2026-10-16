import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(`${process.cwd()}/${p}`, "utf8");

const policy = read("lib/demo-policy.ts");
const matchesApi = read("app/api/matches/route.ts");
const matchmakingApi = read("app/api/matchmaking/route.ts");
const joinApi = read("app/api/matches/[id]/join/route.ts");
const startApi = read("app/api/matches/[id]/start/route.ts");
const demoModeApi = read("app/api/demo-mode/route.ts");
const demoCreate = read("components/CreateMatch/DemoCreateMatch.tsx");
const live = read("components/Live/Live.tsx");

// ---------------------------------------------------------------------------
// 1. Server-side source of truth: the global flag gates CREATE and JOIN.
// ---------------------------------------------------------------------------
assert.match(
  policy,
  /async function assertDemoUserCanCreateOrJoinInTransaction[\s\S]{0,400}const settings = await readSettings\(tx, "SHARE"\);[\s\S]{0,120}if \(!settings\?\.enabled\) throw new Error\("DEMO_DISABLED"\);/,
  "the global DEMO flag is enforced before any new DEMO match may be created or joined",
);
assert.ok(
  policy.indexOf('if (!settings?.enabled) throw new Error("DEMO_DISABLED")') < policy.indexOf('const blocked = await tx.$queryRaw'),
  "the global switch is checked before (and independent of) the per-user block",
);
assert.match(policy, /throw new Error\("DEMO_USER_BLOCKED"\)/, "the per-user block remains enforced");
assert.match(policy, /if \(!settings\?\.enabled\) throw new Error\("DEMO_DISABLED"\);\n  if \(match\.status !== "READY"/, "start reservations still fail closed when DEMO is off");

// ---------------------------------------------------------------------------
// 2. Every DEMO entrypoint returns a real error instead of proceeding.
// ---------------------------------------------------------------------------
assert.match(matchesApi, /if \(code === "DEMO_DISABLED"\) return NextResponse\.json\(\{ error: "[^"]+", errorCode: code \}, \{ status: 409 \}\)/, "POST /api/matches maps DEMO_DISABLED to a 409");
assert.match(matchmakingApi, /if \(code === "DEMO_DISABLED"\) return NextResponse\.json\(\{ error: "[^"]+", errorCode: code \}, \{ status: 409 \}\)/, "POST /api/matchmaking maps DEMO_DISABLED to a 409");
assert.match(joinApi, /if \(msg === "DEMO_DISABLED"\) return NextResponse\.json\(\{ error: "[^"]+", errorCode: msg \}, \{ status: 409 \}\)/, "POST /api/matches/:id/join maps DEMO_DISABLED to a 409");
assert.match(startApi, /code === "DEMO_DISABLED" \|\| code === "DEMO_DAILY_LIMIT_REACHED"/, "POST /api/matches/:id/start still reports DEMO_DISABLED");

// The DEMO path is the only one that consults the policy, so REAL matches are unaffected.
assert.match(matchesApi, /if \(demoContext\) \{[\s\S]{0,140}assertDemoUserCanCreateOrJoin\(user\.id, "CREATE"\)/, "only DEMO creation is gated by the kill switch");
assert.match(joinApi, /if \(demoContext\) \{[\s\S]{0,2200}assertDemoUserCanCreateOrJoin\(user\.id, "JOIN"\)/, "only DEMO joins are gated by the kill switch");

// ---------------------------------------------------------------------------
// 3. Public, fail-closed status endpoint.
// ---------------------------------------------------------------------------
assert.match(demoModeApi, /prisma\.demoModeSettings\.findUnique/, "the status endpoint reads the singleton settings row");
assert.match(demoModeApi, /enabled: Boolean\(settings\?\.enabled\)/, "status reports the real global flag");
assert.match(demoModeApi, /catch[\s\S]{0,200}enabled: false/, "status fails closed on a read error or missing settings");
assert.match(demoModeApi, /"Cache-Control": "no-store"/, "status is never cached");

// ---------------------------------------------------------------------------
// 4. UI must not offer DEMO create/join while the switch is off.
// ---------------------------------------------------------------------------
assert.match(demoCreate, /fetch\("\/api\/demo-mode"/, "the DEMO create page consults the global switch");
assert.match(demoCreate, /enabled===false\?/, "the DEMO create page hides the form when DEMO is off");
assert.match(demoCreate, /copy\.disabled/, "the DEMO create page explains the disabled state");

assert.match(live, /fetch\("\/api\/demo-mode"/, "the lobby consults the global switch");
assert.match(live, /demoEnabled===false\?/, "the lobby hides the create link when DEMO is off");
assert.match(live, /if\(match\.economyMode==="DEMO"&&demoEnabled===false\)\{showMessage\(demoDisabled\);return\}/, "the lobby refuses to start a DEMO join locally when DEMO is off");

console.log("Global DEMO kill switch enforcement and UI gating: PASS");
