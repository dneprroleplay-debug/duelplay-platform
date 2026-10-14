import assert from "node:assert/strict";
import fs from "node:fs";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

const root = process.cwd();
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/match-currency") {
      return nextResolve(pathToFileURL(`${root}/lib/match-currency.ts`).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const { formatMatchAmount, getMatchDisplayTotals } = await import(pathToFileURL(`${root}/lib/match-currency.ts`));
const { getDemoNotificationBody, getDemoNotificationTitle } = await import(pathToFileURL(`${root}/lib/demo-notifications.ts`));
const source = (file) => fs.readFileSync(`${root}/${file}`, "utf8");

for (const language of ["RU", "UA", "EN", "PL"]) {
  assert.equal(formatMatchAmount("DEMO", 100), "DC 100.00", `${language} DEMO amount format`);
  assert.doesNotMatch(formatMatchAmount("DEMO", 100), /\$|ДК/);
  const title = getDemoNotificationTitle(language, "CANCELLATION");
  const body = getDemoNotificationBody(language, "CANCELLATION", { matchId: "match-id", economyMode: "DEMO" });
  assert.match(title, /^(DEMO|ДЕМО) ·/);
  assert.match(body, /реальн|real|rzeczywist/i, `${language} cancellation must distinguish the real balance`);
  const payout = getDemoNotificationBody(language, "WIN", { payout: "180.0000", economyMode: "DEMO" });
  assert.ok(payout.includes("DC 180.00"), `${language} payout should use the invariant DC symbol`);
  assert.doesNotMatch(payout, /\$/);
  const createdPayload = { matchId: "match-id", economyMode: "DEMO", kind: "DEMO_MATCH_CREATED" };
  const createdTitle = getDemoNotificationTitle(language, "SYSTEM", createdPayload);
  const createdBody = getDemoNotificationBody(language, "SYSTEM", createdPayload);
  assert.match(createdTitle, /^(DEMO|ДЕМО) ·/);
  assert.match(createdBody, /DC/);
  assert.match(createdBody, /real|реальн|реальн|rzeczywist/i, `${language} creation message must state real money was unaffected`);
  assert.match(createdBody, /second|втор|друг|drug/i, `${language} creation message must say it is waiting for a second player`);
}
assert.equal(formatMatchAmount("REAL", 100), "$100.00", "REAL currency remains dollar-formatted");
assert.equal(formatMatchAmount("DEMO", 100), "DC 100.00", "DEMO currency remains DC-only");

const waiting = getMatchDisplayTotals("100.0000", "20.0000", false, true);
assert.deepEqual(waiting, { currentBank: 100, fullBank: 200, commission: 20, winnerPayout: 180 });
const joined = getMatchDisplayTotals("100.0000", "20.0000", true, false);
assert.deepEqual(joined, { currentBank: 200, fullBank: 200, commission: 20, winnerPayout: 180 });
const completedWithHistoricalFee = getMatchDisplayTotals("100", "17.5", true, false);
assert.equal(completedWithHistoricalFee.commission, 17.5, "completed-match UI must retain the saved commission");
assert.equal(completedWithHistoricalFee.winnerPayout, 182.5, "completed payout must use saved commission rather than a current rate");
assert.equal(formatMatchAmount("REAL", 100), "$100.00", "one-player REAL refund amount is dollar formatted");
assert.equal(formatMatchAmount("DEMO", 100), "DC 100.00", "one-player DEMO refund amount uses the invariant DC symbol");
assert.equal(formatMatchAmount("REAL", 200), "$200.00", "two-player REAL refund total is dollar formatted");
assert.equal(formatMatchAmount("DEMO", 200), "DC 200.00", "two-player DEMO refund total uses the invariant DC symbol");

const matchPage = source("app/matches/[id]/page.tsx");
assert.match(matchPage, /formatMatchAmount\(m\.economyMode,value\)/);
assert.match(matchPage, /getMatchDisplayTotals\(m\.betAmount,m\.commission,hasPlayerTwo,preJoinEstimate\)/);
assert.match(matchPage, /u\.expectedBank/);
assert.match(matchPage, /u\.preJoinEstimate/);
assert.doesNotMatch(matchPage, /Number\(m\.betAmount\)\.toFixed\(2\)/, "match heading must use shared mode-aware formatter");
assert.match(matchPage, /<span data-no-i18n>\{displayAmount\(Number\(m\.betAmount\)\)\}<\/span>/, "match heading displays the full mode-aware amount");
assert.doesNotMatch(matchPage, /\}\$<span data-no-i18n>\{displayAmount\(Number\(m\.betAmount\)\)\}/, "match heading must not add a currency prefix outside the formatter");
assert.doesNotMatch(matchPage, /getPlatformNumber|COMMISSION_RATE/, "historical match UI must not recompute commission from platform settings");
assert.match(matchPage, /m\.status==="CANCELLED"&&<Notice title=\{isDemo\?u\.cancelledDemo:u\.cancelled\}>/, "cancelled REAL and DEMO matches use their localized cancellation block");
assert.match(matchPage, /hasPlayerTwo\?u\.refundDemoBothBefore:u\.refundDemoOneBefore/, "DEMO refund message distinguishes one stake from both players' stakes");
assert.match(matchPage, /hasPlayerTwo\?u\.refundRealBothBefore:u\.refundRealOneBefore/, "REAL refund message distinguishes one stake from both players' stakes");
assert.match(matchPage, /displayAmount\(Number\(m\.betAmount\)\*\(hasPlayerTwo\?2:1\)\)/, "refund amount uses participant count and the shared currency formatter");
assert.match(matchPage, /<b data-no-i18n>\{displayAmount\(Number\(m\.betAmount\)\*\(hasPlayerTwo\?2:1\)\)\}<\/b>/, "formatted refund currency is protected from translation");
assert.match(matchPage, /m\.status!=="CANCELLED"&&<>[\s\S]*?u\.commission[\s\S]*?u\.winnerGets[\s\S]*?<\/>}/, "cancelled matches hide the standard financial block; other statuses retain it");
for (const locale of ["RU", "UA", "EN", "PL"]) {
  const localeBlock = matchPage.match(new RegExp(`${locale}:\\{([^\\n]*)`))?.[1] || "";
  for (const key of ["cancelledDemo", "refundRealOneBefore", "refundRealOneAfter", "refundRealBothBefore", "refundRealBothAfter", "refundDemoOneBefore", "refundDemoBothBefore", "refundDemoAfter"]) {
    assert.match(localeBlock, new RegExp(`${key}:`), `${locale} locale provides ${key}`);
  }
}
const createMatchApi = source("app/api/matches/route.ts");
assert.match(createMatchApi, /amount\s*\*\s*2\s*\*\s*commissionRate/);
assert.match(createMatchApi, /commission:\s*fee/);
assert.match(createMatchApi, /COMMISSION_RATE\s*\*\s*100/);
assert.match(source("components/CreateMatch/DemoCreateMatch.tsx"), /formatMatchAmount\("DEMO"/);
assert.match(source("components/Live/Live.tsx"), /formatMatchAmount\(match\.economyMode/);
assert.match(source("app/admin/access/page.tsx"), /formatMatchAmount\(m\.economyMode/);

const header = source("components/Header/Header.tsx");
assert.match(header, /if\(p\.economyMode==="DEMO"\)return getDemoNotificationTitle/);
assert.match(header, /if\(p\.economyMode==="DEMO"\)return getDemoNotificationBody/);
assert.match(header, /if\(n\.type==="CANCELLATION"\)/, "REAL cancellation localization path remains present");
const notificationPage = source("app/notifications/page.tsx");
assert.match(notificationPage, /n\.payload\?\.economyMode==="DEMO"/);
assert.match(notificationPage, /getDemoNotificationTitle\(language,n\.type,n\.payload\|\|\{\}\)/);
assert.match(notificationPage, /getDemoNotificationBody\(language,n\.type,n\.payload\|\|\{\}\)/);
assert.match(notificationPage, /data-no-i18n=\{isDemo \? true : undefined\}/, "only DEMO notices should be excluded from global translation on the notifications page");
assert.doesNotMatch(notificationPage, /<h2 data-no-i18n className/);
assert.doesNotMatch(notificationPage, /<p data-no-i18n className/);
assert.match(header, /data-no-i18n=\{isDemo \? true : undefined\}/, "only DEMO notices should be excluded from global translation in the bell");
const createMatchSource = source("app/api/matches/route.ts");
const createHandler = createMatchSource.slice(createMatchSource.indexOf("const create = async"), createMatchSource.indexOf("const result = economyMode"));
assert.match(createHandler, /type: "SYSTEM"[\s\S]{0,260}payload: \{ economyMode: "DEMO", matchId: match\.id, kind: "DEMO_MATCH_CREATED" \}/, "new DEMO match creation emits a marked SYSTEM notification");
assert.match(source("prisma/schema.prisma"), /enum NotificationType[\s\S]*?\bSYSTEM\b/, "the existing SYSTEM notification type is used without a schema change");
assert.ok(createHandler.indexOf("return prior") >= 0 && createHandler.indexOf("return prior") < createHandler.indexOf('const match = await tx.match.create({ data: { economyMode: "DEMO"'), "idempotent retry returns before creating another match or notification");
assert.ok(createHandler.indexOf("reserveDemoStake") < createHandler.indexOf("notification.create"), "DEMO creation notice follows successful stake reservation within the transaction");

const joinApi = source("app/api/matches/[id]/join/route.ts");
assert.match(joinApi, /payload:\s*\{\s*matchId:\s*id,\s*economyMode:\s*"DEMO"\s*\}/);
assert.match(joinApi, /payload:\s*\{\s*matchId:\s*id\s*\}\s*\}\]\s*\}\);/, "REAL MATCH_READY payload shape remains unchanged");
assert.match(source("app/api/matches/[id]/cancel/route.ts"), /payload:\s*\{\s*matchId:\s*id,\s*economyMode:\s*"DEMO"\s*\}/, "manual cancellation notification carries match ID and DEMO marker");
const matchmakingApi = source("app/api/matchmaking/route.ts");
assert.match(matchmakingApi, /economyMode\s*===\s*"DEMO"\s*\?\s*\{\s*economyMode:\s*"DEMO"\s*\}/);
for (const file of ["app/api/matches/[id]/cancel/route.ts", "app/api/matches/[id]/server/route.ts", "app/api/matches/[id]/result/route.ts", "app/api/matches/[id]/local-test/route.ts", "lib/match-lifecycle.ts"]) {
  assert.match(source(file), /economyMode:\s*"DEMO"/, `${file} must mark its DEMO event payload`);
}
assert.match(source("lib/match-lifecycle.ts"), /payout:\s*demoPayout\.toString\(\)/, "technical-win DEMO notification carries its credited amount");
assert.match(source("app/api/matches/[id]/result/route.ts"), /Ты победил в CS2 1х1 и получил \$\$\{payout\.toFixed\(2\)\}/, "REAL settlement notification text remains unchanged");
assert.match(source("lib/match-lifecycle.ts"), /closeDemoWalletHold\(userId, match\.id/);
assert.match(source("app/api/matches/[id]/cancel/route.ts"), /closeDemoWalletHold/);
const postgresIntegration = source("scripts/test-demo-wallet-postgres.integration.mjs");
assert.match(postgresIntegration, /user cancellation before LIVE releases quota and refunds the DEMO hold exactly once/);
assert.match(postgresIntegration, /DEMO operations do not touch REAL wallet, ledger, deposit or withdrawal tables/);

console.log("DEMO UI policy: PASS (currency, saved-fee estimates, localized notices, payload markers, and REAL-format contracts)");
