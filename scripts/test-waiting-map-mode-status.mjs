import assert from "node:assert/strict";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const matchPage = fs.readFileSync(`${root}/app/matches/[id]/page.tsx`, "utf8");
const ownProfile = fs.readFileSync(`${root}/app/profile/page.tsx`, "utf8");
const publicProfile = fs.readFileSync(`${root}/app/profile/[nickname]/page.tsx`, "utf8");

const { DUEL_MODES } = await import(pathToFileURL(`${root}/lib/duel-modes.ts`));
const { DUEL_MAPS } = await import(pathToFileURL(`${root}/lib/duel-maps.ts`));

// --- Task 2: map + mode descriptions shown while waiting for the second player
assert.ok(matchPage.includes('import { DUEL_MODES } from "@/lib/duel-modes"'), "match page imports the real duel-mode catalog");
assert.ok(matchPage.includes("const modeConfig=DUEL_MODES.find((x)=>x.id===m.mode)||null"), "mode config is resolved from the persisted match mode");
assert.ok(matchPage.includes("const mapConfig=getDuelMap(m.mapName)"), "map config is resolved from the persisted match map");
assert.ok(matchPage.includes("{(mapConfig||modeConfig)&&"), "map/mode description block renders only when catalog data exists");
assert.ok(matchPage.indexOf('m.status==="WAITING_FOR_PLAYERS"') < matchPage.indexOf("{(mapConfig||modeConfig)&&"), "descriptions render inside the waiting state branch");
assert.ok(matchPage.includes('data-no-i18n className="mt-2 text-lg font-black text-white">{mapConfig.displayName}</div>'), "map name comes from the catalog and is protected from translation");
assert.ok(matchPage.includes('data-no-i18n className="mt-2 text-lg font-black text-white">{modeConfig.label}</div>'), "mode label comes from the catalog and is protected from translation");
assert.ok(matchPage.includes('mapDescriptionText(language,mapConfig?.id,mapConfig?.description||"")'), "map description comes from the localized catalogue helper");
assert.ok(matchPage.includes('{mapDescription&&<p className="mt-2 text-sm leading-6 text-zinc-400">{mapDescription}</p>}'), "map description renders only when the catalog provides it");
assert.ok(matchPage.includes('modeDescriptionText(language,m.mode,modeConfig.description||"")'), "mode description comes from the localized catalogue helper");
assert.ok(matchPage.includes('{modeDescriptionText(language,m.mode,modeConfig.description||"")&&<p className="mt-2 text-sm leading-6 text-zinc-400">'), "mode description renders only when the catalog provides it");

assert.ok(DUEL_MODES.length >= 8, "duel-mode catalog is populated");
for (const mode of DUEL_MODES) {
  assert.ok(mode.id && mode.label && mode.description, `duel mode ${mode.id} has id/label/description`);
}
assert.ok(DUEL_MAPS.length >= 1, "duel-map catalog is populated");
for (const map of DUEL_MAPS) {
  assert.ok(map.displayName && map.description, `map ${map.id} has displayName/description`);
}

// --- Task 3: creator/opponent statuses in the waiting state
assert.ok(matchPage.includes('cancelled?u.cancelled:ready?"READY":u.waitingStatus'), "READY/WAITING badge logic is preserved");
assert.ok(matchPage.includes('crown={true} betLabel={displayAmount(Number(m.betAmount))} ready={m.status!=="CANCELLED"}'), "the duel creator card shows READY while the second player is still missing");
assert.ok(matchPage.includes('<PlayerCard player={displayPlayerTwo} avatar={p2} betLabel={displayAmount(Number(m.betAmount))} ready={hasPlayerTwo}'), "the second player card stays WAITING until they join");
assert.equal([...matchPage.matchAll(/cancelled=\{m\.status==="CANCELLED"\}/g)].length, 2, "both player cards still receive cancellation state");
assert.ok(matchPage.includes("{user?.id===m.playerOneId?u.readyWaitingOpponent:u.waitingText}"), "the creator sees the 'you are ready, waiting for opponent' message in the waiting banner");
assert.ok(matchPage.includes("player?.nickname||(cancelled?u.player2:u.waitingPlayer)"), "the empty second-player card shows the generic waiting player label");
assert.ok(!matchPage.includes("u.readyConnect"), "the empty second-player card no longer advertises readiness to connect");

for (const locale of ["RU", "UA", "EN", "PL"]) {
  const block = matchPage.match(new RegExp(`${locale}:\\{([^\\n]*)`))?.[1] || "";
  assert.match(block, /mode:"[^"]+"/, `${locale} locale defines the localized mode key`);
  assert.match(block, /readyWaitingOpponent:"[^"]+"/, `${locale} locale defines the creator waiting message`);
}

// --- Task 1: adaptive theming of the profile-completion card
assert.ok(ownProfile.includes('h-full rounded-full bg-[var(--theme-accent)] transition-all"'), "own-profile completion bar uses the active theme accent");
assert.ok(ownProfile.includes("style={{width:`${Math.min(100,Math.max(0,Number(data.profileCompletion||0)))}%`}}"), "own-profile completion bar keeps its percentage calculation");
assert.ok(ownProfile.includes("border-[var(--theme-accent)]/20 bg-[var(--theme-accent-bg)] p-4 text-sm font-bold text-[var(--theme-accent-soft)]"), "reward box uses adaptive theme tokens");
assert.ok(!ownProfile.includes("border-pink-400/20 bg-pink-400/[.06] p-4"), "the completion reward box no longer leaks hardcoded pink");
assert.ok(publicProfile.includes('<div className="h-full rounded-full bg-[var(--theme-accent)]" style={{width:`${Math.min(100,Math.max(0,Number(p.profileCompletion||0)))}%`}}/>'), "public profile completion bar uses the active theme accent");
assert.ok(!publicProfile.includes('h-full rounded-full bg-pink-400"'), "public profile completion bar no longer hardcodes pink");

console.log("Waiting-state map/mode descriptions, creator/opponent statuses, and adaptive profile-completion theming: PASS");
