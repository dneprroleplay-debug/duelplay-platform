"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { languages } from "../../lib/language";

type Language = keyof typeof languages;
type LanguageContextType = {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: typeof languages.RU;
};

const LanguageContext = createContext<LanguageContextType | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>("EN");

  useEffect(() => {
    const saved = window.localStorage.getItem("duelplay-language-v2") as Language | null;
    if (saved && saved in languages) {
      setLanguageState(saved);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("duelplay-language-v2", language);
    document.documentElement.lang =
      language === "RU"
        ? "ru"
        : language === "UA"
          ? "uk"
          : language === "PL"
            ? "pl"
            : "en";
  }, [language]);

  const setLanguage = (lang: Language) => {
    if (lang === language) return;

    window.localStorage.setItem("duelplay-language-v2", lang);
    setLanguageState(lang);
    window.location.reload();
  };

  // English is the single source-of-truth UI language. The selected language
  // controls the global DeepL layer; components always receive English keys/text
  // so we never translate one already-translated locale into another.
  const value = useMemo(
    () => ({
      language,
      setLanguage,
      t: languages.EN,
    }),
    [language]
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const c = useContext(LanguageContext);

  if (!c) {
    throw new Error("useLanguage must be used inside LanguageProvider");
  }

  return c;
}
