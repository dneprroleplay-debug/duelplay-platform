"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import FrameAvatar from "@/components/Common/FrameAvatar";
import { preloadImage, preloadImages } from "../lib/image-preload";
import { heroBackgroundImage, heroBackgroundOptions } from "@/lib/hero-backgrounds";
import { useSearchParams } from "next/navigation";
import Live from "../components/Live/Live";
import CreateMatch from "../components/CreateMatch/CreateMatch";
import { useLanguage } from "../components/Common/LanguageContext";
import TopSkins from "../components/TopSkins/TopSkins";
import Cases from "../components/Cases/Cases";
import HomeIntro from "../components/Common/HomeIntro";
import BannerStrip from "../components/Home/BannerStrip";
import { deferEffectTask } from "@/lib/effect-defer";

function HomeContent(){
  const {t}=useLanguage();
  const searchParams=useSearchParams();
  const [introKey,setIntroKey]=useState(1);
  const playedIntro=useRef<string|null>(null);
  const [loading,setLoading]=useState(false);
  const [refreshKey,setRefreshKey]=useState(0);
  const [count,setCount]=useState(0);
  const [openMatches,setOpenMatches]=useState<Array<{id:string;status:string}>>([]);
  const HERO_STORAGE_KEY="duelplay-hero-background-v1";

  // The server always renders the default hero. Reading sessionStorage during
  // the first client render made returning visitors hydrate a different
  // background than the SSR markup, which React reports as hydration error #418.
  // The stored value is applied in an effect after hydration instead.
  const [heroBackground,setHeroBackground]=useState("hero-01");const [commissionRate,setCommissionRate]=useState(10);

  useEffect(()=>{
    try{
      const saved=window.sessionStorage.getItem(HERO_STORAGE_KEY);
      if(saved&&/^hero-(0[1-9]|10)$/.test(saved)){
        deferEffectTask(() => setHeroBackground(saved));
      }
    }catch{}
  },[]);

  const warmAllHomeImages=async()=>{
    // Only the background that is actually shown is preloaded; preloading all ten
    // hero images pulled ~20 MB before the first paint and delayed every other
    // image on the page.
    const heroes=[heroBackgroundImage(heroBackground)];

    const seasons=[
      "winter",
      "spring",
      "summer",
      "autumn",
      "halloween"
    ].map(
      x=>`/season-heroes/${x}.png`
    );

    await preloadImages([
      ...heroes,
      ...seasons
    ]);
  };

  useEffect(()=>{
    let disposed=false;
    const syncHero=async()=>{
      if(disposed||document.visibilityState==="hidden")return;
      try{
        const r=await fetch("/api/site-settings",{cache:"no-store"});
        if(!r.ok)return;
        const d=await r.json();
        const next=String(d?.heroBackground||"");if(typeof d?.commissionRate==="number")setCommissionRate(d.commissionRate);
        if(!/^hero-(0[1-9]|10)$/.test(next))return;
        if(next===heroBackground)return;
        setHeroBackground(next);
        try{window.sessionStorage.setItem(HERO_STORAGE_KEY,next);}catch{}
      }catch{}
    };
    const onVisible=()=>{void syncHero()};
    document.addEventListener("visibilitychange",onVisible);
    window.addEventListener("focus",onVisible);
    const poll=window.setInterval(()=>{void syncHero()},60000);
    return()=>{disposed=true;document.removeEventListener("visibilitychange",onVisible);window.removeEventListener("focus",onVisible);window.clearInterval(poll)};
  },[heroBackground]);

  useEffect(()=>{
    const timer=window.setTimeout(()=>{
      void warmAllHomeImages();
    },1800);

    return()=>{
      window.clearTimeout(timer);
    };
  },[]);

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
      setOpenMatches(list.filter((m:{id:string;status:string})=>m.status==="WAITING_FOR_PLAYERS").slice(0,4));
      if(typeof settings.heroBackground==="string"){ if(typeof settings.commissionRate==="number")setCommissionRate(settings.commissionRate);
        const nextHero=settings.heroBackground;

        // Apply the stored hero immediately and preload it in the background:
        // the background must not wait for the image to finish downloading.
        setHeroBackground(nextHero);
        try{window.sessionStorage.setItem(HERO_STORAGE_KEY,nextHero);}catch{}
        void preloadImage(
          heroBackgroundImage(nextHero)
        ).then(()=>{

          try{
            window.sessionStorage.setItem(
              HERO_STORAGE_KEY,
              nextHero
            );
          }catch{}
        });
      }
    }).catch(()=>{setCount(0);setOpenMatches([])}).finally(()=>setTimeout(()=>setLoading(false),350));
  },[refreshKey]);

  if(loading)return <div className="fixed inset-0 z-[140] grid place-items-center bg-black"/>;

  return <div id="top" className="min-h-screen text-white"><HomeIntro key={introKey} trigger={introKey>0}/>
    
    <main className="pt-16">
      <BannerStrip/>
      <section className="hero home-hero relative overflow-hidden border-b border-white/5">
        <div
          className="hero-base-art absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:`url("${heroBackgroundImage(heroBackground)}")`
          }}
        />
        <div className="hero-base-overlay absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(255,47,145,.14),transparent_34%),linear-gradient(180deg,rgba(5,5,7,.18),rgba(5,5,7,.10)_48%,rgba(5,5,7,.72)_100%)]"/>
        <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(5,5,7,.72)_0%,transparent_28%,transparent_72%,rgba(5,5,7,.22)_100%)]"/>
        <div className="home-hero-content relative z-10 mx-auto flex max-w-7xl flex-col items-center px-4 text-center sm:px-6">
          <span className="pill"><span data-no-i18n>1v1</span> · CS2 · REAL MATCHES</span>
          <h1 className="home-hero-title mt-3 max-w-5xl font-black uppercase tracking-[-.055em]">{t.heroTitleNew}</h1>
          <p className="home-hero-subtitle mt-2 max-w-4xl text-base leading-7 text-zinc-200 sm:text-lg">{t.heroTextNew}</p>
          <div className="home-hero-bottom">
            <div className="flex flex-wrap justify-center gap-3">
              <a href="#create" className="rounded-2xl bg-pink-400 px-7 py-4 font-black text-black shadow-[0_12px_45px_rgba(255,47,145,.22)] transition hover:bg-pink-300 active:scale-95">{t.createDuel}</a>
              <a href="#live" className="rounded-2xl border border-white/20 bg-black/35 px-7 py-4 font-bold backdrop-blur-sm transition hover:border-pink-400/40 hover:bg-pink-400/[.06] hover:text-pink-200 active:scale-95">{t.openDuels}</a>
            </div>
            <div className="mt-4 grid w-full max-w-3xl grid-cols-3 gap-2 sm:gap-3">
              <Stat value={String(count)} label={t.activeDuels}/>
              <Stat value={<span data-no-i18n>1v1</span>} label={t.formatLabel}/>
              <Stat value={`${commissionRate}%`} label={t.commissionLabel}/>
            </div>
          </div>
        </div>
      </section>

      <Live refreshKey={refreshKey} mode="waiting" showFilters/>
      <CreateMatch onCreated={()=>setRefreshKey(v=>v+1)}/>
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
  </div>
}

function Stat({value,label}:{value:React.ReactNode;label:string}){return <div className="panel rounded-2xl border-white/10 bg-black/30 p-4"><div className="text-2xl font-black text-pink-400">{value}</div><div className="mt-1 text-[10px] uppercase tracking-wider text-zinc-500">{label}</div></div>}
function HowItWorks(){const{t}=useLanguage();return <div className="panel rounded-3xl p-7 sm:p-9"><span className="pill">{t.howItWorks}</span><h2 className="mt-4 text-3xl font-black uppercase">{t.fromDuelToWin}</h2><div className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-2">{[["01",t.stepCreateMatchTitle,t.stepCreateMatchText],["02",t.stepFindOpponentTitle,t.stepFindOpponentText],["03",t.stepPlayTitle,t.stepPlayText],["04",t.stepWinningsTitle,t.stepWinningsText]].map(([n,x,d])=><div key={n} className="group rounded-2xl border border-white/5 bg-white/[.025] p-4 transition hover:-translate-y-0.5 hover:border-pink-400/20"><div className="flex items-center gap-3"><span className="grid h-8 w-8 place-items-center rounded-lg bg-pink-400/10 text-xs font-black text-pink-400">{n}</span><div className="font-bold">{x}</div></div><div className="mt-2 pl-11 text-xs leading-5 text-zinc-500">{d}</div></div>)}</div></div>}
function Ranking(){
 const {t}=useLanguage();
 const [users,setUsers]=useState<{nickname:string;level:number;xp:number;avatarUrl:string|null;rating:number;equippedFrame?:{slug:string;name:string;imageUrl:string|null}|null}[]>([]);
 const [loading,setLoading]=useState(true);
 useEffect(()=>{fetch("/api/ranking",{cache:"no-store"}).then(r=>r.json()).then(d=>setUsers(Array.isArray(d)?d:[])).catch(()=>{}).finally(()=>setLoading(false))},[]);
 const top=users.slice(0,3);
 const medals=["🥇","🥈","🥉"];
 return <div className="flex h-full flex-col justify-center">
  <div className="grid gap-3 sm:grid-cols-3">
   {loading?[0,1,2].map(i=><div key={i} className="h-40 animate-pulse rounded-2xl bg-white/[.03]"/>):top.length?top.map((u,i)=><Link key={u.nickname} href={`/profile/${encodeURIComponent(u.nickname)}`} className={`group relative overflow-hidden rounded-2xl border border-white/5 bg-white/[.03] p-4 transition hover:-translate-y-1 hover:border-pink-400/30 hover:bg-white/[.06] ${i===0?"ring-1 ring-pink-400/40 sm:-translate-y-1":""}`}><div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-pink-400/10 blur-2xl"/><div className="relative flex items-center justify-between"><span className="text-2xl" aria-hidden>{medals[i]}</span><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-pink-400/10 text-sm font-black text-pink-300">#{i+1}</span></div><div className="relative mt-3 flex items-center gap-3"><FrameAvatar src={u.avatarUrl} alt={u.nickname} frame={u.equippedFrame} className="h-12 w-12" imageClassName="border border-white/10"/><div className="min-w-0 flex-1"><div data-player-name className="truncate font-bold">{u.nickname}</div><div className="mt-0.5 text-xs text-zinc-500">Level {u.level}</div></div></div><div className="relative mt-4 text-xl font-black text-pink-400">{u.rating} <span className="text-xs text-zinc-600">RATING</span></div></Link>):<div className="rounded-2xl bg-white/[.03] p-6 text-center text-sm text-zinc-500 sm:col-span-3">{t.noResults}</div>}
  </div>
  <div className="mt-5 text-center"><Link href="/rating" className="text-sm font-bold text-pink-400 transition hover:text-pink-300">Full rating →</Link></div>
 </div>;
}

export default function Home(){
  return <Suspense fallback={null}><HomeContent /></Suspense>
}

