"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Games from "../components/Games/Games";
import Live from "../components/Live/Live";
import CreateMatch from "../components/CreateMatch/CreateMatch";
import { useLanguage } from "../components/Common/LanguageContext";
import TopSkins from "../components/TopSkins/TopSkins";
import Cases from "../components/Cases/Cases";
import HomeIntro from "../components/Common/HomeIntro";
import BannerStrip from "../components/Home/BannerStrip";

function HomeContent(){
  const {t}=useLanguage();
  const searchParams=useSearchParams();
  const [introKey,setIntroKey]=useState(1);
  const playedIntro=useRef<string|null>(null);
  const [loading,setLoading]=useState(false);
  const [refreshKey,setRefreshKey]=useState(0);
  const [count,setCount]=useState(0);
  const [openMatches,setOpenMatches]=useState<any[]>([]);
  const [heroBackground,setHeroBackground]=useState("hero-01");
  const [selectedMap,setSelectedMap]=useState("Mirage");

  const introParam=searchParams.get("intro");
  useEffect(()=>{
    if(!introParam || playedIntro.current===introParam)return;
    playedIntro.current=introParam;
    setIntroKey(v=>v+1);
  },[introParam]);

  useEffect(()=>{
    Promise.all([
      fetch("/api/matches",{cache:"no-store"}).then(r=>r.json()),
      fetch("/api/site-settings",{cache:"no-store"}).then(r=>r.json())
    ]).then(([matches,settings])=>{
      const list=Array.isArray(matches)?matches:[];
      setCount(list.length);
      setOpenMatches(list.filter((m:any)=>m.status==="WAITING_FOR_PLAYERS").slice(0,4));
      if(typeof settings.heroBackground==="string")setHeroBackground(settings.heroBackground);
    }).catch(()=>{setCount(0);setOpenMatches([])}).finally(()=>setTimeout(()=>setLoading(false),350));
  },[refreshKey]);

  if(loading)return <div className="fixed inset-0 z-[140] grid place-items-center bg-black"/>;

  return <div id="top" className="min-h-screen text-white"><HomeIntro key={introKey} trigger={introKey>0}/>
    
    <main className="pt-16">
      <BannerStrip/>
      <section className="hero home-hero relative overflow-hidden border-b border-white/5">
        <div className="hero-base-art absolute inset-0 bg-cover bg-center" style={{backgroundImage:`url("/hero-backgrounds/${heroBackground}.jpg")`}}/>
        <div className="hero-base-overlay absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(255,47,145,.14),transparent_34%),linear-gradient(180deg,rgba(5,5,7,.18),rgba(5,5,7,.10)_48%,rgba(5,5,7,.72)_100%)]"/>
        <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(5,5,7,.72)_0%,transparent_28%,transparent_72%,rgba(5,5,7,.22)_100%)]"/>
        <div className="home-hero-content relative z-10 mx-auto flex max-w-7xl flex-col items-center px-4 text-center sm:px-6">
          <span className="pill">1х1 · CS2 · REAL MATCHES</span>
          <h1 className="home-hero-title mt-3 max-w-5xl font-black uppercase tracking-[-.055em]">{t.heroTitleNew}</h1>
          <p className="home-hero-subtitle mt-2 max-w-4xl text-base leading-7 text-zinc-200 sm:text-lg">{t.heroTextNew}</p>
          <div className="home-hero-bottom">
            <div className="flex flex-wrap justify-center gap-3">
              <a href="#create" className="rounded-2xl bg-pink-400 px-7 py-4 font-black text-black shadow-[0_12px_45px_rgba(255,47,145,.22)] transition hover:bg-pink-300 active:scale-95">{t.createDuel}</a>
              <a href="#live" className="rounded-2xl border border-white/20 bg-black/35 px-7 py-4 font-bold backdrop-blur-sm transition hover:border-pink-400/40 hover:bg-pink-400/[.06] hover:text-pink-200 active:scale-95">{t.openDuels}</a>
            </div>
            <div className="mt-4 grid w-full max-w-3xl grid-cols-3 gap-2 sm:gap-3">
              <Stat value={String(count)} label={t.activeDuels}/>
              <Stat value="1х1" label={t.formatLabel}/>
              <Stat value="10%" label={t.commissionLabel}/>
            </div>
          </div>
        </div>
      </section>

      <Games onSelectMap={setSelectedMap}/>
      <Live refreshKey={refreshKey} mode="waiting" showFilters/>
      <CreateMatch selectedMap={selectedMap} onCreated={()=>setRefreshKey(v=>v+1)}/>
      <TopSkins/>
      <Cases/>

      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <div className="grid gap-5 lg:grid-cols-2">
          <HowItWorks/>
          <div className="panel rounded-3xl p-7 sm:p-9">
            <span className="pill">{t.fairPlay}</span>
            <h2 className="mt-4 text-3xl font-black uppercase">{t.fairPlayTitle}<br/><span className="text-pink-400">{t.fairPlayTitle2}</span></h2>
            <p className="mt-4 text-sm leading-6 text-zinc-500">{t.fairPlay}</p>
            <div className="mt-7 space-y-3">
              {[
                ["01",t.betLocked,t.bothPlayersStake],
                ["02",t.cs2Starts,t.productionNote],
                ["03",t.serverResultTitle,t.serverResultText],
              ].map(([n,title,text])=><div key={n} className="flex gap-4 rounded-2xl border border-white/5 bg-white/[.025] p-4"><span className="text-sm font-black text-pink-400">{n}</span><div><div className="font-bold">{title}</div><div className="mt-1 text-sm leading-6 text-zinc-500">{text}</div></div></div>)}
            </div>
          </div>
        </div>
      </section>

      <section id="rating" className="mx-auto max-w-7xl px-4 pb-20 sm:px-6">
        <div className="panel rounded-3xl p-8 sm:p-10"><div className="grid gap-8 lg:grid-cols-[1fr_1.5fr]"><div><span className="pill">RANKING</span><h2 className="mt-4 text-4xl font-black uppercase">{t.ratingTitle}</h2><p className="mt-3 text-zinc-500">{t.ratingText}</p></div><Ranking/></div></div>
      </section>
    </main>
    <footer className="border-t border-white/5 py-8 text-center text-sm text-zinc-600">DUELPLAY · CS2 1х1 · 2026</footer>
  </div>
}

function Stat({value,label}:{value:string;label:string}){return <div className="panel rounded-2xl border-white/10 bg-black/30 p-4"><div className="text-2xl font-black text-pink-400">{value}</div><div className="mt-1 text-[10px] uppercase tracking-wider text-zinc-500">{label}</div></div>}
function HowItWorks(){const{t}=useLanguage();return <div className="panel rounded-3xl p-7 sm:p-9"><span className="pill">{t.howItWorks}</span><h2 className="mt-4 text-3xl font-black uppercase">{t.fromDuelToWin}</h2><div className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-2">{[["01",t.stepCreateMatchTitle,t.stepCreateMatchText],["02",t.stepFindOpponentTitle,t.stepFindOpponentText],["03",t.stepPlayTitle,t.stepPlayText],["04",t.stepWinningsTitle,t.stepWinningsText]].map(([n,x,d])=><div key={n} className="group rounded-2xl border border-white/5 bg-white/[.025] p-4 transition hover:-translate-y-0.5 hover:border-pink-400/20"><div className="flex items-center gap-3"><span className="grid h-8 w-8 place-items-center rounded-lg bg-pink-400/10 text-xs font-black text-pink-400">{n}</span><div className="font-bold">{x}</div></div><div className="mt-2 pl-11 text-xs leading-5 text-zinc-500">{d}</div></div>)}</div></div>}
function Ranking(){const [users,setUsers]=useState<any[]>([]);useEffect(()=>{fetch("/api/ranking",{cache:"no-store"}).then(r=>r.json()).then(d=>setUsers(Array.isArray(d)?d:[])).catch(()=>{})},[]);return <div className="grid gap-3 sm:grid-cols-3">{users.slice(0,3).map((u,i)=><div key={u.nickname} className={`rounded-2xl bg-white/[.03] p-4 transition hover:-translate-y-0.5 hover:bg-white/[.06] ${i===0?"ring-1 ring-pink-400/30":""}`}><div className="flex items-center gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-pink-400/10 text-sm font-black text-pink-300">#{i+1}</span><div className="min-w-0"><div className="truncate font-bold">{u.nickname}</div><div className="mt-1 text-xs text-zinc-500">Level {u.level}</div></div></div><div className="mt-4 text-xl font-black text-pink-400">{u.reputation} <span className="text-xs text-zinc-600">REP</span></div></div>)}</div>}

export default function Home(){
  return <Suspense fallback={null}><HomeContent /></Suspense>
}
