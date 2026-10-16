import assert from "node:assert/strict";
import fs from "node:fs";

const root = process.cwd();
const page = fs.readFileSync(`${root}/app/matches/[id]/page.tsx`, "utf8");
const auth = fs.readFileSync(`${root}/components/Common/AuthContext.tsx`, "utf8");
const gate = fs.readFileSync(`${root}/components/Common/MaintenanceGate.tsx`, "utf8");

// --- Polling must stop once the match is terminal (CANCELLED/FINISHED) --------
assert.ok(page.includes("const terminalSyncRef=useRef<string|null>(null);"), "terminal transition is tracked with a one-shot ref");
assert.ok(page.includes('if(m?.status==="FINISHED"||m?.status==="CANCELLED")return;'), "the polling effect bails out for terminal matches");
assert.ok(
  page.indexOf('if(m?.status==="FINISHED"||m?.status==="CANCELLED")return;') < page.indexOf("setInterval(tick,1000)"),
  "terminal matches never reach the setInterval call"
);
assert.ok(page.includes("clearInterval(timer);"), "the polling interval is cleared on cleanup/unmount");
assert.ok(page.includes('document.removeEventListener("visibilitychange",onVisibility);'), "the visibility listener is removed on cleanup");
assert.ok(page.includes('window.removeEventListener("duelplay:match-refresh",onPlatformChanged);'), "the platform-refresh listener is removed on cleanup");

// --- The terminal sync effect must run once per status (no fetch loop) --------
assert.ok(page.includes("if(terminalSyncRef.current===status)return;"), "the terminal sync runs at most once per status");
assert.ok(page.includes("terminalSyncRef.current=status;"), "the terminal sync marks the handled status");
assert.ok(page.includes("if(status!==\"FINISHED\"&&status!==\"CANCELLED\"){terminalSyncRef.current=null;return}"), "the terminal sync guard resets outside terminal states");

// --- Auth refresh needs a stable identity, otherwise effects loop forever -----
assert.ok(auth.includes("useCallback,"), "auth context imports useCallback");
assert.ok(auth.includes("const refresh = useCallback(async () => {"), "auth refresh is wrapped in useCallback");
assert.ok(auth.includes("const logout = useCallback(async () => {"), "auth logout is wrapped in useCallback");
assert.ok(auth.includes("[user, loading, refresh, logout]"), "context value memo depends on the stable callbacks");

// --- A slow request must not queue more requests ------------------------------
assert.ok(page.includes("if(!id||loadInFlight.current)return;"), "match polling has an in-flight guard against overlapping requests");
assert.ok(page.includes("loadInFlight.current=true;") && page.includes("loadInFlight.current=false"), "the in-flight guard is set before the request and released afterwards");

// --- A transient maintenance fetch failure must not lock the whole site -------
assert.ok(gate.includes("state?.enabled&&!state.isAdmin"), "the maintenance gate still exists");
assert.ok(gate.includes('path!=="/login"') && gate.includes('path!=="/test-login"'), "login/test-login stay reachable");
assert.ok(!gate.includes("setState({enabled:true"), "a failed maintenance fetch must not force the maintenance screen");
assert.ok(gate.includes("controller.abort()"), "the in-flight maintenance request is aborted on cleanup");

console.log("Match terminal polling, timer cleanup, stable auth refresh and maintenance fail-open: PASS");
