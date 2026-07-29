"use client";

import Image from "next/image";
import { useLanguage } from "../Common/LanguageContext";
import { languages } from "../../lib/language";

export default function Games() {
  const { language } = useLanguage();
  const t = languages[language];

const matches = [
  {
    map: t.dust2,
    image: "/images/maps/dust2.jpg",
    players: "1/2",
    bet: 250,
  },
  {
    map: t.mirage,
    image: "/images/maps/mirage.jpg",
    players: "1/2",
    bet: 500,
  },
  {
    map: t.inferno,
    image: "/images/maps/inferno.jpg",
    players: "1/2",
    bet: 1000,
  },
  {
    map: t.nuke,
    image: "/images/maps/nuke.jpg",
    players: "1/2",
    bet: 750,
  },
  {
    map: t.ancient,
    image: "/images/maps/ancient.jpg",
    players: "1/2",
    bet: 1500,
  },
  {
    map: t.anubis,
    image: "/images/maps/anubis.jpg",
    players: "1/2",
    bet: 300,
  },
  {
    map: t.train,
    image: "/images/maps/train.jpg",
    players: "1/2",
    bet: 2000,
  },
  {
    map: t.overpass,
    image: "/images/maps/overpass.jpg",
    players: "1/2",
    bet: 1250,
  },
];

const getCurrency = () => {
  switch (language) {
    case "EN":
      return "$";

    case "PL":
      return "zł";

    case "UA":
      return "₴";

    default:
      return "₴";
  }
};

  return (
    <section className="mx-auto max-w-7xl px-6 py-24">
      <div className="mb-12 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-4xl font-bold">
            🎯 {t.activeMatchesTitle}
          </h2>

          <p className="mt-4 text-zinc-400">
            {t.activeMatchesText}
          </p>
        </div>

        <button className="rounded-xl bg-cyan-500 px-6 py-3 font-bold text-black transition hover:bg-cyan-400">
          {t.createMatch}
        </button>
      </div>

      <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        {matches.map((match) => (
          <div
            key={match.map}
            className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 transition-all hover:scale-105 hover:border-cyan-500"
          >
            <div className="relative h-48">
              <Image
                src={match.image}
                alt={match.map}
                fill
                className="object-cover"
              />
            </div>

            <div className="p-5">
              <h3 className="text-xl font-bold text-cyan-400">
                CS2 • {match.map}
              </h3>

              <p className="mt-2 text-zinc-400">
                {t.players}: {match.players}
              </p>

              <p className="mt-1 font-bold text-yellow-400">
                {t.bet}: {match.bet} {getCurrency()}
              </p>

              <div className="mt-4 flex items-center justify-between text-sm text-zinc-500">
                <span>{t.mode1v1}</span>
                <span>LIVE</span>
              </div>

              <button className="mt-4 w-full rounded-xl bg-cyan-500 py-3 font-bold text-black transition hover:bg-cyan-400">
                {t.joinMatch}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}