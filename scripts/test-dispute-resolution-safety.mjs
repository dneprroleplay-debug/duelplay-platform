import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const route = read("app/api/disputes/route.ts");
const admin = read("components/Admin/LegacyAdminPanel.tsx");
const translation = read("components/Common/GlobalUiI18n.tsx");
const translateRoute = read("app/api/translate/route.ts");
const deepl = read("lib/deepl.ts");
let checks = 0;
function check(condition, message) {
  assert.ok(condition, message);
  checks += 1;
  console.log(`PASS ${message}`);
}

// Valid/invalid decision contract.
check(/const DECISIONS = \["DRAW", "WINNER_PLAYER_ONE", "WINNER_PLAYER_TWO", "CANCELLED_REFUND"\]/.test(route), "only the four supported dispute decisions are accepted");
check(/if \(!id \|\| !isDecision\(decisionValue\)\) return NextResponse\.json\(\{ error: "Invalid dispute decision" \}, \{ status: 400 \}\)/.test(route), "invalid or missing decisions return HTTP 400 before settlement");

// Concurrent/replayed requests and transaction boundaries.
check(/WHERE id = \$\{id\}::uuid FOR UPDATE/.test(route) && /WHERE id = \$\{d\.matchId\}::uuid FOR UPDATE/.test(route), "dispute and match rows are locked during resolution");
check(/if \(\["RESOLVED_BY_ADMIN", "CLOSED"\]\.includes\(d\.status\)\)[\s\S]*?if \(d\.adminDecision !== decisionValue\) throw new Error\("DISPUTE_DECISION_CONFLICT"\)[\s\S]*?return \{ id: d\.id, idempotent: true \}/.test(route), "same-decision retries are idempotent and conflicting retries are rejected");
check(/withDemoPolicyTransaction\(async \(\{ db: tx, demo \}\) => \{[\s\S]*?creditWallet\(tx[\s\S]*?releaseWalletHold\(tx[\s\S]*?tx\.match\.update[\s\S]*?tx\.dispute\.update/.test(route), "wallet settlement and match/dispute state changes share one transaction");
check(/\[disputes\] resolution failed[\s\S]*?disputeId:[\s\S]*?matchId:[\s\S]*?stage:[\s\S]*?errorCode:[\s\S]*?prismaCode:/.test(route), "financial failures log safe dispute/match IDs, stage, and error codes");
check((route.match(/tx\.auditLog\.create\(/g) || []).length === 2 && !/if \(!result\.idempotent\)\s*await auditRequest/.test(route), "resolution audit is written inside the same transaction for REAL and DEMO");
check(/if \(code === "DISPUTE_DECISION_CONFLICT"[\s\S]*?status: 409/.test(route), "a repeated request with a different decision returns HTTP 409");
check(/disputeResolveInFlight\.current\)return false[\s\S]*?disputeResolveInFlight\.current=true[\s\S]*?finally\{disputeResolveInFlight\.current=false/.test(admin), "admin UI blocks rapid duplicate PATCH submissions");

// Translation request pressure: only newly-added content requiring remote translation schedules another pass.
check(/function needsRemoteTranslation\(text: string\)/.test(translation), "client identifies text that actually needs a remote translation");
check(/function addedNodeNeedsTranslation\(node: Node\): boolean/.test(translation), "observer checks added content instead of reacting to every child-list mutation");
check(/new MutationObserver\(\(records\) => \{[\s\S]*?addedNodeNeedsTranslation\(addedNode\)[\s\S]*?schedule\(\)/.test(translation), "DOM observer only schedules a pass when added nodes need remote translation");
check(/enforceIpRateLimit\(tx, ip, "TRANSLATE_API", 30, 10 \* 60_000\)/.test(translateRoute), "translation rate limit remains enabled and unchanged");
check(/error\.message === "RATE_LIMITED"[\s\S]*?status: 429/.test(translateRoute), "translation throttling still returns 429 rather than bypassing the limit");
check(/translationCache\.findMany/.test(deepl) && /translationCache\.createMany/.test(deepl), "persistent DeepL translation cache remains enabled");

console.log(`Dispute/translation safety source checks: PASS (${checks} assertions).`);
