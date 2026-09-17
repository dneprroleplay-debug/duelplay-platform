import { languages } from "./language";

export type CanonicalLanguage = keyof typeof languages;
type LocaleTree = Record<string, unknown>;

const SOURCE_TO_TARGET: Record<CanonicalLanguage, Map<string, string>> = { RU:new Map(), UA:new Map(), EN:new Map(), PL:new Map() };
const LOCALIZED_CANDIDATES: Record<CanonicalLanguage, Map<string, Set<string>>> = { RU:new Map(), UA:new Map(), EN:new Map(), PL:new Map() };
const UNIQUE_LOCALIZED_TO_SOURCE: Record<CanonicalLanguage, Map<string, string>> = { RU:new Map(), UA:new Map(), EN:new Map(), PL:new Map() };

function walk(en: unknown, locales: Record<CanonicalLanguage, unknown>) {
  if (typeof en === "string") {
    const source=en.trim();
    if (!source) return;
    for (const language of Object.keys(SOURCE_TO_TARGET) as CanonicalLanguage[]) {
      const value=locales[language];
      if (typeof value !== "string") continue;
      const localized=value.trim();
      if (!localized) continue;
      if (!SOURCE_TO_TARGET[language].has(source)) SOURCE_TO_TARGET[language].set(source, localized);
      const set=LOCALIZED_CANDIDATES[language].get(localized) || new Set<string>();
      set.add(source);
      LOCALIZED_CANDIDATES[language].set(localized,set);
    }
    return;
  }
  if (!en || typeof en !== "object" || Array.isArray(en)) return;
  const enObj=en as LocaleTree;
  for (const key of Object.keys(enObj)) {
    const child=enObj[key];
    const nested: Record<CanonicalLanguage, unknown> = {
      RU: locales.RU && typeof locales.RU === "object" ? (locales.RU as LocaleTree)[key] : undefined,
      UA: locales.UA && typeof locales.UA === "object" ? (locales.UA as LocaleTree)[key] : undefined,
      EN: locales.EN && typeof locales.EN === "object" ? (locales.EN as LocaleTree)[key] : undefined,
      PL: locales.PL && typeof locales.PL === "object" ? (locales.PL as LocaleTree)[key] : undefined,
    };
    walk(child,nested);
  }
}

walk(languages.EN,{RU:languages.RU,UA:languages.UA,EN:languages.EN,PL:languages.PL});

for (const language of Object.keys(LOCALIZED_CANDIDATES) as CanonicalLanguage[]) {
  for (const [localized,sources] of LOCALIZED_CANDIDATES[language]) {
    if (sources.size===1) UNIQUE_LOCALIZED_TO_SOURCE[language].set(localized,[...sources][0]);
  }
}

export function translateCanonicalUi(language: CanonicalLanguage, text: string): string | null {
  const raw=text.trim();
  if (!raw) return null;
  const direct=SOURCE_TO_TARGET[language].get(raw);
  if (direct) return text.replace(raw,direct);
  for (const sourceLanguage of Object.keys(UNIQUE_LOCALIZED_TO_SOURCE) as CanonicalLanguage[]) {
    const source=UNIQUE_LOCALIZED_TO_SOURCE[sourceLanguage].get(raw);
    if (!source) continue;
    const target=SOURCE_TO_TARGET[language].get(source);
    if (target) return text.replace(raw,target);
  }
  return null;
}
