"use client";

import { useLanguage } from "../Common/LanguageContext";
import { languages } from "../../lib/language";

export default function Live() {
  const { language } = useLanguage();
  const t = languages[language];

  const matches = [
    {
      map: "Dust2",
      players: "12/16",
      bet: 250,
      status: "LIVE",
    },
    {
      map: "Mirage",
      players: "8/10",
      bet: 500,
      status: "LIVE",
    },
    {
      map: "Inferno",
      players: "6/10",
      bet: 1000,
      status: "LIVE",
    },
  ];

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
              CS2 • {match.map}
            </div>

            <div className="text-zinc-300">
              {t.players}: {match.players}
            </div>

            <div className="mt-2 text-yellow-400 font-bold">
              {t.bet}: {match.bet} ₴
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