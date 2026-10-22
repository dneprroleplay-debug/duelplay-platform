/**
 * Regression tests for the post-testing fixes: DEMO wallet, DEMO routing,
 * notification rendering, dispute resolution and evidence, the "all matches"
 * entry point, live hero updates, image loading and the TOP-3 heading.
 *
 * Run: node scripts/test-flow-regressions.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { registerHooks } from "node:module";

const root = process.cwd();
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/lib/")) {
      return nextResolve(pathToFileURL(`${root}/lib/${specifier.slice("@/lib/".length)}.ts`).href, context);
    }
    return nextResolve(specifier, context);
  },
});
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

let passed = 0;
let failed = 0;
const check = (ok, label) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  ok ? passed++ : failed++;
};

// ---------------------------------------------------------------- 1. DEMO wallet
{
  const wallet = read("app/wallet/page.tsx");
  check(/href="\/create-demo"/.test(wallet), "the DEMO wallet button opens /create-demo");
  check(!/href="\/create"[^>]*>\{D\.play\}/.test(wallet), "the DEMO wallet button no longer opens the REAL match creation");
  check(/Number\(demo\?\.debtBalance\?\?0\)>0&&/.test(wallet), "the virtual debt is only shown when it is not zero");
  check(/debtHint/.test(wallet), "the virtual debt carries an explanation");
  for (const language of ["debtHint:", "Возникает только при отмене", "Виникає лише при скасуванні", "Powstaje wyłącznie przy anulowaniu", "Appears only when previously credited"]) {
    check(wallet.includes(language), `the virtual debt explanation is localized (${language.slice(0, 28)})`);
  }
  const demoWallet = read("lib/demo-wallet.ts");
  check(demoWallet.includes("debtOffset"), "the debt is still repaid from incoming credits (accounting logic kept)");
  check(demoWallet.includes("DEBT_ADJUSTMENT"), "the debt repayment is still recorded in the DEMO ledger");
}

// ---------------------------------------------------------------- 2. DEMO route
{
  const route = read("app/create-demo/page.tsx");
  check(/DemoCreateMatch/.test(route), "/create-demo renders the DEMO match creation screen");
  const demo = read("components/CreateMatch/DemoCreateMatch.tsx");
  check(/economyMode[=:]\s*"?DEMO/.test(demo) || /demo/i.test(demo), "the DEMO creation screen uses the DEMO economy");
  check(!/api\/matches"\s*,\s*\{method:"POST"/.test(demo), "the DEMO screen does not post to the REAL match API");
}

// ---------------------------------------------------------------- 3. notifications
{
  const header = read("components/Header/Header.tsx");
  check(header.includes("ADMIN_BROADCAST"), "the bell recognises an administration broadcast");
  check(header.includes("ADMIN_SENDER"), "the bell renders the administration sender");
  check(/if\(n\.type==="SYSTEM"&&n\.title\)return n\.title;/.test(header), "a stored SYSTEM notification keeps its own title");
  check(/if\(n\.type==="SYSTEM"&&n\.body\)return n\.body;/.test(header), "a stored SYSTEM notification keeps its own text");
  const adminApi = read("app/api/admin/route.ts");
  check(adminApi.includes('kind:"ADMIN_BROADCAST"'), "the administration broadcast is stored with its own kind");
  check(adminApi.includes("sentBy:me.nickname"), "the broadcast keeps the administrator identity");
  const page = read("app/notifications/page.tsx");
  check(page.includes("adminSender"), "the notifications page shows the administration sender");
  const disputes = read("app/api/disputes/route.ts");
  check(disputes.includes("notifyDisputeUpdate"), "dispute events still notify both participants");
}

// ---------------------------------------------------------------- 4. disputes
{
  const admin = read("components/Admin/LegacyAdminPanel.tsx");
  check(/fetch\("\/api\/disputes",\{method:"PATCH"/.test(admin), "the admin resolves a dispute through the disputes API");
  check(!/action:"resolveDispute"/.test(admin), "the admin no longer posts an unknown action to the admin API");
  check(admin.includes("x.error||L.operationFailed"), "a failed dispute decision shows the server error");
  check(admin.includes("x.evidences"), "the admin sees the attached evidence");
  const { validateEvidenceFile, EVIDENCE_MAX_BASE64_CHARS } = await import(pathToFileURL(`${root}/lib/dispute-evidence.ts`));
  const png = `data:image/png;base64,${"A".repeat(64)}`;
  assert.equal(validateEvidenceFile(png, "IMAGE").ok, true, "a small PNG data URL is accepted");
  assert.equal(validateEvidenceFile(png, "VIDEO").ok, false, "an image cannot be attached as a video");
  assert.equal(validateEvidenceFile("data:application/x-msdownload;base64,AAAA", "IMAGE").ok, false, "an unsupported mime type is rejected");
  assert.equal(validateEvidenceFile(`data:image/png;base64,${"A".repeat(EVIDENCE_MAX_BASE64_CHARS + 10)}`, "IMAGE").ok, false, "an oversized file is rejected");
  assert.equal(validateEvidenceFile("https://example.com/file.png", "IMAGE").ok, true, "an https reference is accepted");
  assert.equal(validateEvidenceFile("http://example.com/file.png", "IMAGE").ok, false, "a plain http reference is rejected");
  assert.equal(validateEvidenceFile("file:///etc/passwd", "IMAGE").ok, false, "a local path is rejected");
  const playerDisputes = read("app/disputes/page.tsx");
  check(playerDisputes.includes('action: "evidence"'), "the player can attach evidence to a dispute");
  check(playerDisputes.includes("readAsDataURL"), "the player upload is transferred as a data URL");
  check(playerDisputes.includes("EVIDENCE") === false && playerDisputes.includes("attach("), "the player upload reports progress and errors");
}

// ---------------------------------------------------------------- 5. all matches
{
  const history = read("components/Match/MatchHistory.tsx");
  check(history.includes("const allHref") && history.includes('"/matches"'), "the recent block links to the full match list");
  check(history.includes("allMatches"), "the link label is localized");
  const home = read("app/page.tsx");
  check(!home.includes("MatchHistory"), "the home page no longer duplicates the match history");
  const profile = read("app/profile/page.tsx");
  check(profile.includes('<MatchHistory variant="recent" embedded />'), "the personal profile shows the five latest matches");
  const publicProfile = read("app/profile/[nickname]/page.tsx");
  check(publicProfile.includes('<MatchHistory variant="recent" embedded nickname={p.nickname}/>'), "the public profile shows the five latest matches");
  const publicHistory = read("app/profile/[nickname]/history/page.tsx");
  check(publicHistory.includes('<MatchHistory variant="full" nickname={nickname}/>'), "the public profile links to the full history");
  const matchesPage = read("app/matches/page.tsx");
  check(matchesPage.includes('<MatchHistory variant="full"/>'), "the full list page renders filters and pagination");
  check(matchesPage.includes('/live') === false, "the entry point does not lead to the LIVE page");
}

// ---------------------------------------------------------------- 6. hero live update
{
  const home = read("app/page.tsx");
  check(home.includes("syncHero"), "the home page re-checks the stored hero background");
  check(home.includes('setInterval(()=>{void syncHero()},60000)'), "an open session polls the hero setting");
  check(home.includes('"visibilitychange"') && home.includes('"focus"'), "an open session refreshes the hero on focus");
  check(home.includes("sessionStorage.setItem(HERO_STORAGE_KEY"), "the fresh hero is cached for the next visit");
  const siteSettings = read("app/api/site-settings/route.ts");
  check(siteSettings.includes("heroBackground"), "the site settings API still exposes the hero background");
}

// ---------------------------------------------------------------- 7. image loading
{
  const home = read("app/page.tsx");
  check(home.includes("const heroes=[heroBackgroundImage(heroBackground)]"), "only the active hero background is preloaded");
  check(!home.includes("heroBackgroundOptions().map(option=>option.image)"), "the page no longer preloads all ten hero images");
  const history = read("components/Match/MatchHistory.tsx");
  check(history.includes('import Image from "next/image"'), "the match history thumbnails are delivered through next/image");
  check(history.includes('sizes="(max-width:640px) 100vw, 112px"'), "the match history thumbnails declare their sizes");
  const create = read("components/CreateMatch/CreateMatch.tsx");
  check(create.includes("h-auto w-full"), "the map preview shows the whole map");
  check(create.includes("priority"), "the selected map preview is loaded with high priority");
}

// ---------------------------------------------------------------- 8. TOP-3 heading
{
  const ru = read("locales/ru.ts");
  const ua = read("locales/ua.ts");
  const en = read("locales/en.ts");
  const pl = read("locales/pl.ts");
  check(ru.includes('ratingTitle:"ТОП-3 игрока сайта"'), "the rating block is titled TOP-3 in RU");
  check(ua.includes('ratingTitle:"ТОП-3 гравці сайту"'), "the rating block is titled TOP-3 in UA");
  check(en.includes('ratingTitle:"Top 3 players on the site"'), "the rating block is titled TOP-3 in EN");
  check(pl.includes('ratingTitle:"Top 3 graczy serwisu"'), "the rating block is titled TOP-3 in PL");
  const home = read("app/page.tsx");
  check(home.includes("users.slice(0,3)"), "the rating block still shows at most three players");
  check(home.includes("#{i+1}"), "the rating block still renders the #1..#3 places");
}

// ---------------------------------------------------------------- 9. map visibility
{
  const match = read("app/matches/[id]/page.tsx");
  const matchBanner = match.slice(match.indexOf("relative h-56"), match.indexOf("absolute inset-x-5 bottom-7"));
  check(matchBanner.includes("object-cover object-center"), "the match banner fills the full width with the selected map image");
  check(!matchBanner.includes("object-contain"), "the match banner no longer letterboxes the map with side bars");
  check(!/bg-black/.test(matchBanner), "the match banner has no black side bars");
  check(matchBanner.includes("mapImage||\"/images/maps/mirage.jpg\""), "the banner uses the catalogue image of the selected map");
  const create = read("components/CreateMatch/CreateMatch.tsx");
  const createPreview = create.slice(create.indexOf("map-preview-"), create.indexOf("</Field><Field label=\"Mode\">"));
  check(!createPreview.includes("blur-"), "the match creation preview has no blur effect");
  check(!createPreview.includes("saturate-"), "the match creation preview has no colour-altering filter");
  check(!createPreview.includes("radial-gradient"), "the match creation preview has no coloured overlay or gradient");
  check(!createPreview.includes("object-cover"), "the match creation preview no longer crops the map");
  check(createPreview.includes("h-auto w-full"), "the match creation preview keeps the map's original aspect ratio");
  check(createPreview.includes("quality={90}"), "the match creation preview requests a crisp image");
  check(!create.includes("DUEL_MAPS.map((m)=>m.image)\n    );"), "the creation page no longer preloads all ten map images");
}

console.log(`\nSummary: ${passed} PASS, ${failed} FAIL`);
process.exitCode = failed ? 1 : 0;
