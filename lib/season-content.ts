export type SeasonContent = {
  id: string;
  label: string;
  hero: string | null;
  background: string | null;
  particle: string;
  decorations: Record<string, boolean>;
};

/**
 * Visual content catalog for every supported DuelPlay seasonal preset.
 * The engine may override particle/decorations from the persisted season effects,
 * but each preset always has a deterministic visual fallback.
 */
export const SEASONAL_CONTENT: Record<string, SeasonContent> = {
  winter: { id:"winter", label:"Winter", hero:"winter", background:"winter", particle:"winter", decorations:{snowman:true} },
  spring: { id:"spring", label:"Spring", hero:"spring", background:"spring", particle:"spring", decorations:{flowers:true} },
  summer: { id:"summer", label:"Summer", hero:"summer", background:"summer", particle:"summer", decorations:{sun:true} },
  autumn: { id:"autumn", label:"Autumn", hero:"autumn", background:"autumn", particle:"autumn", decorations:{leaf:true} },
  "new-year": { id:"new-year", label:"New Year", hero:"winter", background:"new-year", particle:"newyear", decorations:{snowman:true,tree:true,gift:true,fireworks:true} },
  christmas: { id:"christmas", label:"Christmas", hero:"winter", background:"christmas", particle:"christmas", decorations:{snowman:true,tree:true,gift:true} },
  halloween: { id:"halloween", label:"Halloween", hero:"halloween", background:"halloween", particle:"halloween", decorations:{pumpkin:true,ghost:true} },
  easter: { id:"easter", label:"Easter", hero:"spring", background:"easter", particle:"easter", decorations:{flowers:true,eggs:true} },
  valentines: { id:"valentines", label:"Valentine's Day", hero:"spring", background:"valentines", particle:"hearts", decorations:{hearts:true} },
  "st-patricks": { id:"st-patricks", label:"St. Patrick's Day", hero:"spring", background:"st-patricks", particle:"stpatricks", decorations:{flowers:true,clover:true} },
  "april-fools": { id:"april-fools", label:"April Fools", hero:"spring", background:"april-fools", particle:"aprilfools", decorations:{confetti:true} },
  "lunar-new-year": { id:"lunar-new-year", label:"Lunar New Year", hero:"winter", background:"lunar-new-year", particle:"lunarnewyear", decorations:{lanterns:true,fireworks:true} },
  thanksgiving: { id:"thanksgiving", label:"Thanksgiving", hero:"autumn", background:"thanksgiving", particle:"thanksgiving", decorations:{leaf:true,turkey:true} },
  esports: { id:"esports", label:"Esports", hero:null, background:"esports", particle:"esports", decorations:{} },
  none: { id:"none", label:"None", hero:null, background:null, particle:"default", decorations:{} },
};

export function getSeasonContent(id?: unknown, preset?: unknown): SeasonContent {
  const key = String(id ?? preset ?? "none").trim().toLowerCase();
  return SEASONAL_CONTENT[key] ?? SEASONAL_CONTENT.none;
}
