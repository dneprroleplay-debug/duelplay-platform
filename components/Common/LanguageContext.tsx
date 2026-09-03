"use client";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { languages } from "../../lib/language";

type Language = keyof typeof languages;
type LanguageContextType = { language: Language; setLanguage: (lang: Language) => void; t: typeof languages.RU };
const LanguageContext = createContext<LanguageContextType | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>("RU");
  useEffect(() => {
    const saved = window.localStorage.getItem("duelplay-language") as Language | null;
    if (saved && saved in languages) setLanguageState(saved);
  }, []);
  useEffect(() => {
    window.localStorage.setItem("duelplay-language", language);
    document.documentElement.lang = language === "RU" ? "ru" : language === "UA" ? "uk" : language === "PL" ? "pl" : "en";
  }, [language]);
  const value = useMemo(() => ({ language, setLanguage: (lang: Language) => setLanguageState(lang), t: languages[language] }), [language]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
export function useLanguage() { const c = useContext(LanguageContext); if (!c) throw new Error("useLanguage must be used inside LanguageProvider"); return c; }
