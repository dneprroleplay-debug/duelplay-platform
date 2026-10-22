import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const source = (p) => fs.readFileSync(path.join(root, p), "utf8");

const route = source("app/api/wallet/transactions/route.ts");
const page = source("app/wallet/page.tsx");
const wallet = source("lib/wallet.ts");
const lifecycle = source("lib/match-lifecycle.ts");
const locales = { ru: source("locales/ru.ts"), ua: source("locales/ua.ts"), en: source("locales/en.ts"), pl: source("locales/pl.ts") };

// --- the endpoint ------------------------------------------------------------
assert.match(route, /export async function GET\(request: NextRequest\)/, "the wallet history endpoint accepts a request");
assert.match(route, /const user = await getCurrentUser\(\);[\s\S]{0,200}?status: 401/, "the history requires an authenticated session");
assert.match(route, /prisma\.wallet\.findUnique\(\{\s*where: \{ userId: user\.id \}/, "the history is read from the wallet of the signed-in user");
assert.doesNotMatch(route, /userId: body|userId: request|userId: query/, "the history never takes a user id from the client");
assert.doesNotMatch(route, /demoTransaction|demoWallet/i, "the REAL history never reads DEMO tables");

// --- pagination --------------------------------------------------------------
assert.match(route, /HISTORY_PAGE_SIZE = 25/, "the history has a default page size");
assert.match(route, /HISTORY_MAX_PAGE_SIZE = 100/, "the history page size is capped");
assert.match(route, /request\.nextUrl\.searchParams\.get\("cursor"\)/, "the history supports a cursor");
assert.match(route, /request\.nextUrl\.searchParams\.get\("limit"\)/, "the history supports a page size");
assert.match(route, /where: \{ id: cursorId, walletId: wallet\.id \}/, "a cursor is only accepted for the own wallet");
assert.match(route, /status: 400/, "an unknown cursor is rejected");
assert.match(route, /take: limit \+ 1/, "the history reads one extra row to detect a next page");
assert.match(route, /nextCursor:/, "the history returns the next cursor");
assert.match(route, /hasMore,/, "the history reports whether more rows exist");
assert.match(route, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/, "the history is ordered newest first with a stable tiebreaker");

// --- the journal payload ------------------------------------------------------
for (const field of ["balanceBefore: true", "balanceAfter: true", "lockedBalanceBefore: true", "lockedBalanceAfter: true", "status: true", "currency: true", "referenceType: true", "referenceId: true"]) {
  assert.ok(route.includes(field), `the history exposes ${field.replace(": true", "")}`);
}
assert.match(route, /enforceRateLimit\(tx, user\.id, "WALLET_HISTORY_VIEW"/, "the history endpoint is rate limited");
assert.match(route, /isRateLimitError\(error\)/, "a rate limited history request answers with 429");

// --- the wallet page ----------------------------------------------------------
assert.match(page, /loadHistory\(cursor\?:string\|null\)/, "the wallet page loads a history page");
assert.match(page, /t\.walletHistoryLoadMore/, "the wallet page offers a load more control");
assert.match(page, /t\.walletHistoryError/, "the wallet page shows an error state");
assert.match(page, /t\.walletHistoryMatch/, "the wallet page shows the related match");
assert.match(page, /t\.walletHistoryBalance/, "the wallet page shows the balance after the operation");
assert.match(page, /t\.walletHistoryStatus/, "the wallet page shows the operation status");
assert.match(page, /txLoading\?/, "the wallet page has a loading state");
assert.match(page, /t\.noTransactions/, "the wallet page keeps an empty state");
assert.match(page, /tx\.referenceType==="MATCH"/, "the wallet page links a match operation to its match");
assert.match(page, /Number\(tx\.amount\)>=0\?"shrink-0 text-emerald-300":"shrink-0 text-red-300"/, "the wallet page shows income and spending differently");
assert.match(page, /DEMO · DC/, "the DEMO wallet stays next to the REAL history");
assert.doesNotMatch(page, /demoTransaction/, "the wallet page never mixes DEMO rows into the REAL history");

// --- locales ------------------------------------------------------------------
const newKeys = ["walletHistoryLoadMore", "walletHistoryError", "walletHistoryMatch", "walletHistoryStatus", "walletHistoryBalance"];
const newTypes = ["WITHDRAWAL_RESERVE", "WITHDRAWAL_RELEASE", "WITHDRAWAL_COMPLETED", "MATCH_STAKE_LOCK", "MATCH_STAKE_RELEASE", "TOURNAMENT_ENTRY", "EVENTPASS_PURCHASE", "INVENTORY_SALE"];
for (const [language, content] of Object.entries(locales)) {
  for (const key of newKeys) assert.ok(content.includes(`${key}:`), `${language} defines ${key}`);
  for (const type of newTypes) assert.ok(content.includes(`${type}:`), `${language} labels the ${type} operation`);
}

// --- journal completeness -----------------------------------------------------
assert.match(wallet, /async function appendTransaction/, "every real money operation appends a journal row");
assert.match(wallet, /status:\s*"COMPLETED"/, "a journal row is written as a completed operation");
assert.match(wallet, /idempotencyKey/, "every journal row is idempotent");
assert.match(wallet, /balanceBefore[\s\S]{0,120}?balanceAfter/, "a journal row keeps the balance before and after");
assert.match(wallet, /FOR UPDATE/, "the wallet row is locked before the balance changes");

const moneyFiles = fs.readdirSync(path.join(root, "app"), { recursive: true })
  .concat(fs.readdirSync(path.join(root, "lib"), { recursive: true }))
  .filter((entry) => typeof entry === "string" && /\.tsx?$/.test(entry))
  .map((entry) => {
    const base = entry.startsWith("app") ? "app" : "lib";
    return `${base}/${entry.replace(/\\/g, "/")}`;
  })
  .filter((file) => fs.existsSync(path.join(root, file)));

const directBalanceWrites = moneyFiles.filter((file) => {
  if (file === "lib/wallet.ts" || file === "lib/promotions.ts") return false;
  if (file.startsWith("lib/generated/")) return false;
  const content = source(file);
  return /\b(wallet|tx)\.update\(\{[\s\S]{0,200}?(balance|lockedBalance|bonusBalance)\s*:\s*\{/.test(content)
    || /\btransaction\.create\(/.test(content);
});
assert.deepEqual(directBalanceWrites, [], "no real balance change bypasses the wallet journal");

const journalWriters = ["lib/wallet.ts", "lib/promotions.ts"];
for (const file of journalWriters) {
  assert.ok(source(file).includes("transaction.create"), `${file} writes a journal row next to the balance change`);
}
assert.match(lifecycle, /creditWallet\(|debitWallet\(|lockWallet\(|releaseWalletHold\(/, "the match settlement writes through the wallet journal");
assert.doesNotMatch(source("lib/demo-wallet.ts"), /creditWallet|debitWallet|lockWallet|releaseWalletHold/, "the DEMO economy never touches the real journal");

console.log("REAL wallet history: PASS");
