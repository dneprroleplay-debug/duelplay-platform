"use client";

import { useLanguage } from "../Common/LanguageContext";
import { languages } from "../../lib/language";
import { useEffect, useState } from "react";
import { getMatches } from "@/lib/api/matches";

export default function Live() {
  const { language } = useLanguage();
  const t = languages[language];
const [matches, setMatches] = useState<any[]>([]);
const [loading, setLoading] = useState(true);
useEffect(() => {
  async function loadMatches() {
    try {
      const data = await getMatches();
      setMatches(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  loadMatches();
}, []);
{matches.length === 0 && (
  <div className="col-span-full text-center text-zinc-400">
    Пока нет активных матчей.
  </div>
)}
  return (
    <section className="mx-auto max-w-7xl px-6 py-24">
      <div className="mb-12 text-center">
        <h2 className="text-4xl font-bold text-white">
          🔴 {t.liveMatches}
        </h2>

        <p className="mt-4 text-zinc-400">
          {t.liveText}
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {matches.map((match, index) => (
          <div
            key={index}
            className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6"
          >
            <div className="mb-4 font-bold text-cyan-400">
              CS2 • {match.mapName}
            </div>

            <div className="text-zinc-300">
              {t.players}: {match.playerTwo
  ? "2/2"
  : "1/2"}
            </div>

            <div className="mt-2 text-yellow-400 font-bold">
              {t.bet}: {match.betAmount} ₴
            </div>

            <div className="mt-4 text-red-500 font-bold">
              {match.status}
            </div>

            <button className="mt-5 w-full rounded-xl bg-red-500 py-3 font-bold text-white transition hover:bg-red-600">
              {t.watchLive}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}