"use client";
import Link from "next/link";
import Live from "@/components/Live/Live";
import MatchmakingPanel from "@/components/Matchmaking/MatchmakingPanel";
import { useLanguage } from "@/components/Common/LanguageContext";

export default function MatchesPage(){
  const {t}=useLanguage();
  return <><main className="min-h-screen pt-16"><MatchmakingPanel/><Live mode="waiting" showFilters/><div className="mx-auto max-w-7xl px-4 pb-20 sm:px-6"><div className="flex justify-center border-t border-white/5 pt-8"><Link href="/create" className="inline-flex rounded-2xl bg-pink-400 px-7 py-4 font-black text-black shadow-[0_12px_45px_rgba(255,47,145,.18)] transition hover:bg-pink-300 active:scale-95">{t.createDuel}</Link></div></div></main></>;
}
