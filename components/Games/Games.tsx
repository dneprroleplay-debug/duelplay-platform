"use client";
import Image from "next/image";
import { useLanguage } from "../Common/LanguageContext";

const games = [
  ["Mirage", "/images/maps/covers/mirage.jpg"],
  ["Dust2", "/images/maps/covers/dust2.jpg"],
  ["Inferno", "/images/maps/covers/inferno.jpg"],
] as const;

export default function Games() {
  const { t } = useLanguage();
  const select = (name: string) => {
    window.dispatchEvent(new CustomEvent("duelplay:select-map", { detail: name }));
    document.getElementById("create")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <section id="maps" className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
      <div className="mb-8">
        <span className="pill">CS2 ARENA</span>
        <h2 className="mt-4 text-4xl font-black">
          {t.chooseMap.split(" ")[0]} <span className="text-pink-400">{t.chooseMap.split(" ").slice(1).join(" ")}</span>
        </h2>
        <p className="mt-2 text-zinc-500">{t.mapsText}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {games.map(([name, image]) => (
          <button
            onClick={() => select(name)}
            key={name}
            className="group relative aspect-[16/9] cursor-pointer overflow-hidden rounded-2xl border border-white/10 bg-black text-left shadow-[0_14px_45px_rgba(0,0,0,.22)] transition duration-300 hover:-translate-y-1 hover:border-pink-400/35 hover:shadow-[0_22px_70px_rgba(0,0,0,.35)]"
          >
            <Image src={image} alt={name} fill sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw" className="object-cover transition duration-500 group-hover:scale-[1.045]" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-5">
              <div className="text-[10px] uppercase tracking-[.18em] text-pink-300">Counter-Strike 2</div>
              <div className="mt-1 text-2xl font-black">{name}</div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
