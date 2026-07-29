"use client";

import { useLanguage } from "../Common/LanguageContext";
import { languages } from "../../lib/language";

export default function Tournaments() {
  const { language } = useLanguage();
  const t = languages[language];

  const tournaments = [
    {
      name: "CS2 Daily Cup",
      prize: "10 000 ₴",
      players: "32 / 32",
      start: "Сегодня 19:00",
    },
    {
      name: "CS2 1v1 Arena",
      prize: "5 000 ₴",
      players: "16 / 16",
      start: "Сегодня 20:00",
    },
    {
      name: "CS2 Weekend Cup",
      prize: "25 000 ₴",
      players: "64 / 64",
      start: "Завтра 15:00",
    },
    {
      name: "CS2 5v5 Cup",
      prize: "50 000 ₴",
      players: "64 / 64",
      start: "Суббота 18:00",
    },
  ];

  return (
    <section className="mx-auto max-w-7xl px-6 py-24">
      <div className="mb-12 text-center">
        <h2 className="text-4xl font-bold">
          🏆 {t.tournamentsTitle}
        </h2>

        <p className="mt-4 text-zinc-400">
          {t.tournamentsText}
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {tournaments.map((tournament, index) => (
          <div
            key={index}
            className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 transition hover:border-cyan-500"
          >
            <h3 className="text-xl font-bold text-cyan-400">
              {tournament.name}
            </h3>

            <div className="mt-4 space-y-2 text-zinc-300">
              <p>💰 {t.bet}: {tournament.prize}</p>
              <p>👥 {t.players}: {tournament.players}</p>
              <p>⏰ {tournament.start}</p>
            </div>

            <button className="mt-6 w-full rounded-xl bg-cyan-500 py-3 font-bold text-black transition hover:bg-cyan-400">
              {t.joinTournament}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}