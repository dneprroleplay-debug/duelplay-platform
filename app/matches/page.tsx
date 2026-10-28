"use client";
import Link from "next/link";
import Live from "@/components/Live/Live";
import MatchmakingPanel from "@/components/Matchmaking/MatchmakingPanel";
import MatchHistory from "@/components/Match/MatchHistory";
import { useLanguage } from "@/components/Common/LanguageContext";
import { useEffect, useState } from "react";
import { translateUi } from "@/lib/ui-i18n";

export default function MatchesPage(){
  const {t,language}=useLanguage();
  const [economy,setEconomy]=useState<"REAL"|"DEMO">("REAL");
  const [economyReady,setEconomyReady]=useState(false);
  useEffect(()=>{setEconomy(new URLSearchParams(window.location.search).get("economyMode")==="DEMO"?"DEMO":"REAL");setEconomyReady(true)},[]);
  return <><main className="min-h-screen pt-16">{!economyReady?<div className="mx-auto max-w-7xl px-4 pt-24 text-center text-zinc-500">Loading…</div>:<><div className="mx-auto max-w-7xl px-4 pt-5 sm:px-6"><div className="flex justify-start"><Link href={economy==="DEMO"?"/create-demo":"/create"} className="inline-flex rounded-2xl bg-pink-400 px-7 py-4 font-black text-black shadow-[0_12px_45px_rgba(255,47,145,.18)] transition hover:bg-pink-300 active:scale-95">{economy==="DEMO"?<span data-no-i18n>{translateUi(language, "Create DEMO")}</span>:t.createDuel}</Link></div></div>{economy==="REAL"&&<MatchmakingPanel/>}<Live mode="waiting" showFilters economy={economy}/>{economy==="REAL"&&<MatchHistory variant="full"/>}</>}</main></>;
}
