import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
let pass = true;

function check(label, condition) {
  if (condition) console.log(`PASS ${label}`);
  else {
    console.error(`FAIL ${label}`);
    pass = false;
  }
}

const language = read("components/Common/LanguageContext.tsx");
check("English is the deterministic default language", /useState<Language>\("EN"\)/.test(language));
check("language choice is persisted", /localStorage\.setItem\("duelplay-language-v2",\s*lang\)/.test(language));
check("language change reloads the page", /window\.location\.reload\(\)/.test(language));
check("English is the canonical UI source", /t:\s*languages\.EN/.test(language));
check("Ukrainian document lang is uk", /language === "UA"\s*\?\s*"uk"/.test(language));

const globalI18n = read("components/Common/GlobalUiI18n.tsx");
check("global translator protects player names", /\[data-player-name\]/.test(globalI18n));
check("global translator protects brands", /\[data-brand\]/.test(globalI18n));
check("global translator protects home intro", /\[data-home-intro\]/.test(globalI18n));
check("global translator processes batches up to 250 texts", /start \+= 250/.test(globalI18n));
check("global translator has persistent browser cache", /duelplay-i18n-cache-v10/.test(globalI18n));
check("global translator does not depend on locale dictionary", !globalI18n.includes("translateUi(lang, source)"));
check("global translator can translate uppercase dynamic phrases", !/if \(\/\^\[A-Z0-9_:\+\.\/-\]\+\$\/\.test\(value\)\) return false/.test(globalI18n));
check("global translator starts promptly after mount", /window\.setTimeout\(\(\) => \{\s*timer = null;\s*void translatePage\(\);\s*\}, 50\)/.test(globalI18n));
check("global translator protects REP", /\bREP\b/.test(globalI18n));
check("global translator protects 1x1 and 1х1 formats", globalI18n.includes('"1x1"') && globalI18n.includes('"1х1"'));
check("live map filters are protected from translation", /function Filter[\s\S]*data-no-i18n/.test(read("components/Live/Live.tsx")));
check("profile privacy uses locale keys", /t\.profileVisibility[\s\S]*t\.visibilityEveryone[\s\S]*t\.visibilityFriends[\s\S]*t\.visibilityPrivate/.test(read("app/profile/page.tsx")));
check("profile email row removed", !/<Row label=\"Email\"/.test(read("app/profile/page.tsx")));
check("XP multiplier is protected", /data-no-i18n className=\"text-xl font-black\">\{plan\.multiplier\}× XP/.test(read("app/xp-boosters/page.tsx")));
check("cosmetic select uses locale dictionary", /t\.cosmeticTypes/.test(read("app/shop/page.tsx")));
check("HUB uses locale dictionary", /t\.hubTitle[\s\S]*t\.hubCards/.test(read("app/hub/page.tsx")));

const translateRoute = read("app/api/translate/route.ts");
check("DeepL maps UA to UK", /UA:\s*"UK"/.test(translateRoute));
check("translation route caps a request at 250 texts", /MAX_ITEMS\s*=\s*250/.test(translateRoute));
const deepl = read("lib/deepl.ts");
check("server translation memory uses the database", /translationCache\.findMany/.test(deepl) && /translationCache\.createMany/.test(deepl));
check("server translation memory is non-fatal", /persistent cache read failed/.test(deepl) && /persistent cache write failed/.test(deepl));

const header = read("components/Header/Header.tsx");
check("header has no wolf fallback", !header.includes("duelplay-wolf-mark-safe.png"));
check("header keeps DUELPLAY brand", header.includes("DUEL<span"));
check("header language names are readable", header.includes('name:"Русский"') && header.includes('name:"Українська"'));
check("mobile search uses locale text", header.includes("{t.search}</Link>"));
check("mobile create uses locale text", header.includes("{t.create}</Link>"));
check("profile nickname is protected", /data-player-name[^>]*className="relative"[\s\S]*\{user\.nickname\}/.test(header));

const home = read("app/page.tsx");
check("hero title uses locale dictionary", /t\.heroTitleNew/.test(home));
check("home ranking nickname is protected", /data-player-name className="truncate font-bold"\>\{u\.nickname\}/.test(home));
check("home intro slogan remains explicitly protected", /data-home-intro/.test(read("components/Common/HomeIntro.tsx")));

for (const p of [
  "app/admin/page.tsx",
  "app/profile/page.tsx",
  "app/matches/[id]/page.tsx",
  "app/profile/[nickname]/page.tsx",
  "components/Header/Header.tsx",
]) {
  const s = read(p);
  check(`${p} has no replacement characters`, !s.includes("�"));
  check(`${p} has no common UTF-8 mojibake marker`, !/(РќР|РџР|РЎР|РђР|вЂ)/.test(s));
}

for (const p of [
  "components/Profile/GlobalPlayerCard.tsx",
  "components/Live/Live.tsx",
  "app/referral-race/page.tsx",
  "app/social/page.tsx",
  "app/clans/page.tsx",
  "app/admin/page.tsx",
]) {
  check(`${p} protects rendered player names`, read(p).includes("data-player-name"));
}

for (const p of [
  "DUELPLAY_FIX_01.md",
  "DUELPLAY_FIX_02.md",
  "DUELPLAY_MASTER_125_PROGRESS.md",
  "DUELPLAY_MASTER_CHECKLIST_V30_STATUS.md",
  "DUELPLAY_V30_I18N_AUDIT.md",
  "DUELPLAY_V23_CHANGES.md",
  "DUELPLAY_V24_CHANGES.md",
  "DUELPLAY_V25_CHANGES.md",
  "DUELPLAY_V26_CHANGES.md",
  "DUELPLAY_V28_CHANGES.md",
  "DUELPLAY_V29_CHANGES.md",
  "DUELPLAY_68_PROGRESS.md",
  "DUELPLAY_70_79_PROGRESS.md",
  "DUELPLAY_HOME_HERO_V12.md",
  "DUELPLAY_SEASON_V4.md",
  "DUELPLAY_SEASON_V7_CLEAN.md",
  "DUELPLAY_V9.md",
  "FINAL_1_125.md",
  "schema_models.txt",
  "tsconfig.tsbuildinfo",
]) {
  check(`obsolete root artifact removed: ${p}`, !fs.existsSync(path.join(root, p)));
}

for (const p of [
  ".env",
  ".env.local",
  "public/next.svg",
  "public/file.svg",
  "public/globe.svg",
  "public/vercel.svg",
  "public/window.svg",
]) {
  check(`unwanted local/generated file absent: ${p}`, !fs.existsSync(path.join(root, p)));
}

console.log(pass ? "Global i18n regression checks passed." : "Global i18n regression checks FAILED.");
process.exit(pass ? 0 : 1);
