"use client";

import { useLanguage } from "../components/Common/LanguageContext";
import { languages } from "../lib/language";
import { useEffect, useState } from "react";
import LoadingScreen from "../components/LoadingScreen/LoadingScreen";
import Header from "../components/Header/Header";
import Games from "../components/Games/Games";
import Live from "../components/Live/Live";
import Tournaments from "../components/Tournaments/Tournaments";
import CreateMatch from "../components/CreateMatch/CreateMatch";

export default function Home() {
  const [loading, setLoading] = useState(true);
const [matchesCount, setMatchesCount] = useState(0);
const { language } = useLanguage();
const t = languages[language];

useEffect(() => {
  const loadMatches = async () => {
    const res = await fetch("/api/matches");
    const data = await res.json();

    setMatchesCount(data.length);
  };

  loadMatches();

  const timer = setTimeout(() => {
    setLoading(false);
  }, 2500);

  return () => clearTimeout(timer);
}, []);

if (loading) {
  return <LoadingScreen />;
}

return (
    <>
      <Header />
      <main className="min-h-screen bg-black text-white">
      <section className="relative h-[550px] overflow-hidden">

  <div
    className="absolute inset-0 bg-cover bg-center"
    style={{
      backgroundImage: "url('/images/hero.jpg')",
    }}
  />

  <div className="absolute inset-0 bg-black/60" />

  <div className="relative z-10 flex h-full flex-col items-center justify-center px-6 text-center">
    <h1 className="z-10 mb-6 text-4xl font-extrabold md:text-5xl">
      {t.heroTitle}
    </h1>

          <p className="z-10 max-w-3xl text-xl text-zinc-400">
            {t.heroText}
          </p>

          <div className="z-10 mt-10 flex flex-wrap justify-center gap-4">
            <button className="rounded-xl bg-cyan-500 px-8 py-4 font-bold text-black transition hover:scale-105 hover:bg-cyan-400">
              ⚡ {t.quickSearch}
            </button>

            <button className="rounded-xl border border-zinc-700 px-8 py-4 transition hover:border-cyan-500 hover:bg-zinc-900">
              🎮 {t.createMatch}
            </button>
          </div>

          <div className="z-10 mt-20 grid grid-cols-2 gap-6 md:grid-cols-4">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
              <div className="text-3xl font-bold text-cyan-400">
  {matchesCount}
</div>
              <div className="text-zinc-400">
                {t.onlinePlayers}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
              <div className="text-3xl font-bold text-cyan-400">
                {matchesCount}
              </div>
              <div className="text-zinc-400">
                {t.activeMatches}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
<div className="text-3xl font-bold text-cyan-400">
  {matchesCount}
</div>

  <div className="text-zinc-400">
    {t.liveNow}
  </div>
</div>
</div>
</div>

</section>

<Games />
<Live />
<Tournaments />
<CreateMatch />
            </main>
            </>
         );
      }