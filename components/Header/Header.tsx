"use client";

import { languages } from "../../lib/language";
import { useLanguage } from "../Common/LanguageContext";

export default function Header() {
  const { language, setLanguage } = useLanguage();

  const t = languages[language];

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-zinc-800 bg-black/80 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <div className="text-2xl font-bold text-cyan-400">
          DuelPlay
        </div>

        <nav className="hidden gap-8 text-zinc-300 md:flex">
          <a href="#">{t.home}</a>
          <a href="#games">{t.matches}</a>
          <a href="#live">{t.live}</a>
          <a href="#tournaments">{t.tournaments}</a>
        </nav>

        <div className="flex items-center gap-3">
          <select
            value={language}
            onChange={(e) =>
              setLanguage(
                e.target.value as keyof typeof languages
              )
            }
            className="rounded-lg border border-zinc-700 bg-black px-3 py-2 text-white"
          >
            <option value="RU">🇷🇺 RU</option>
            <option value="UA">🇺🇦 UA</option>
            <option value="EN">🇺🇸 EN</option>
            <option value="PL">🇵🇱 PL</option>
          </select>

          <button className="rounded-lg border border-zinc-700 px-5 py-2 font-bold text-white hover:bg-zinc-800">
            {t.login}
          </button>

          <button className="rounded-lg bg-cyan-500 px-5 py-2 font-bold text-black hover:bg-cyan-400">
            {t.createMatch}
          </button>
        </div>
      </div>
    </header>
  );
}