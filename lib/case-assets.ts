export const CASE_IMAGE_BY_SLUG: Record<string, string> = {
  starter: "/images/cases/starter_case.png",
  neon: "/images/cases/neon_duel_case.png",
  premium: "/images/cases/premium_arsenal.png",
};

export const CASE_ITEM_IMAGE_BY_NAME: Record<string, string> = {
  "Pistol Core": "/images/case-items/pistol_core.png",
  "Emerald Fang": "/images/case-items/emerald_fang.png",
  "Azure Strike": "/images/case-items/azure_strike.png",
  "Violet Pulse": "/images/case-items/violet_pulse.png",
  "Gold Reaper": "/images/case-items/gold_reaper.png",
  "Neon Wolf": "/images/case-items/neon_wolf.png",
};

export function caseImage(slug: string, fallback = "/case-items/common.svg") {
  return CASE_IMAGE_BY_SLUG[slug] ?? fallback;
}

export function caseItemImage(name: string, fallback = "/case-items/common.svg") {
  return CASE_ITEM_IMAGE_BY_NAME[name] ?? fallback;
}
