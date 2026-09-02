"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Header from "../components/Header/Header";
import LoadingScreen from "../components/LoadingScreen/LoadingScreen";
import Games from "../components/Games/Games";
import Live from "../components/Live/Live";
import CreateMatch from "../components/CreateMatch/CreateMatch";
import { useLanguage } from "../components/Common/LanguageContext";
import TopSkins from "../components/TopSkins/TopSkins";

export default function Home(){
  const {t}=useLanguage();
  const [loading,setLoading]=useState(true);
  const [refreshKey,setRefreshKey]=useState(0);
  const [count,setCount]=useState(0);
  const [openMatches,setOpenMatches]=useState<any[]>([]);

  useEffect(()=>{
    fetch("/api/matches",{cache:"no-store"}).then(r=>r.json()).then(d=>{
      const list=Array.isArray(d)?d:[];
      setCount(list.length);
      setOpenMatches(list.filter((m:any)=>m.status==="WAITING_FOR_PLAYERS").slice(0,4));
    }).catch(()=>{setCount(0);setOpenMatches([])}).finally(()=>setTimeout(()=>setLoading(false),350));
  },[refreshKey]);

  if(loading)return <LoadingScreen/>;

  return <div id="top" className="min-h-screen bg-[#050507] text-white">
    <Header/>
    <main className="pt-16">
      <section className="hero relative overflow-hidden border-b border-white/5">
        <div className="absolute inset-0 bg-cover bg-center" style={{backgroundImage:"url('/images/hero.jpg')"}}/>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(255,47,145,.20),transparent_34%),linear-gradient(90deg,rgba(5,5,7,.98),rgba(5,5,7,.45),rgba(5,5,7,.92))]"/>
        <div className="absolute inset-0 opacity-40 bg-[linear-gradient(0deg,#050507_0%,transparent_35%,transparent_70%,#050507_100%)]"/>
        <div className="relative mx-auto grid max-w-7xl gap-10 px-4 py-24 sm:px-6 lg:grid-cols-[1.1fr_.9fr] lg:items-center lg:py-32">
          <div className="max-w-3xl">
            <span className="pill">1V1 · CS2 · REAL MATCHES</span>
            <h1 className="mt-6 text-5xl font-black uppercase leading-[.9] tracking-[-.055em] sm:text-7xl lg:text-8xl whitespace-pre-line">{t.heroTitleNew}</h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-zinc-300 sm:text-lg">{t.heroTextNew}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#create" className="rounded-2xl bg-pink-400 px-6 py-4 font-black text-black transition hover:bg-pink-300 active:scale-95">{t.createDuel}</a>
              <a href="#live" className="rounded-2xl border border-white/15 bg-black/30 px-6 py-4 font-bold transition hover:border-pink-400/40 hover:bg-pink-400/[.06] hover:text-pink-200 active:scale-95">{t.openDuels}</a>
            </div>
            <div className="mt-10 grid max-w-2xl grid-cols-3 gap-2 sm:gap-3">
              <Stat value={String(count)} label={t.activeDuels}/>
              <Stat value="1v1" label={t.formatLabel}/>
              <Stat value="10%" label={t.commissionLabel}/>
            </div>
          </div>
          <div className="hidden lg:block">
            <div className="panel overflow-hidden rounded-3xl border-pink-400/15 bg-black/45 p-5 backdrop-blur">
              <div className="flex items-center justify-between border-b border-white/10 pb-4"><div><div className="text-xs font-black tracking-[.2em] text-pink-300">LIVE LOBBY</div><div className="mt-1 text-lg font-black">{t.openDuelsTitle}</div></div><span className="status live">ONLINE</span></div>
              <div className="space-y-3 pt-4">
                {openMatches.length>0?openMatches.map((m:any)=><Link href={`/matches/${m.id}`} key={m.id} className="flex items-center gap-3 rounded-2xl border border-white/5 bg-white/[.025] p-3 transition hover:border-pink-400/25 hover:bg-pink-400/[.035]">
                  <div className="h-12 w-20 overflow-hidden rounded-xl"><img src={`/images/maps/covers/${String(m.mapName||"Mirage").toLowerCase()}.jpg`} alt={m.mapName||"CS2"} className="h-full w-full object-cover"/></div>
                  <div className="min-w-0 flex-1"><div className="font-bold">{m.mapName||"Mirage"}</div><div className="mt-1 text-xs text-zinc-500">1/2 {t.players} · 1v1 · {m.playerOne?.nickname||t.player}</div></div>
                  <div className="text-right"><div className="font-black text-pink-300">${Number(m.betAmount).toFixed(2)}</div><div className="text-[10px] text-zinc-600">{t.bet.toUpperCase()}</div></div>
                </Link>):<div className="rounded-2xl border border-white/5 bg-white/[.025] p-6 text-center"><div className="text-sm font-bold">{t.noOpenDuels}</div><div className="mt-1 text-xs text-zinc-600">{t.inviteFriend}</div></div>}
              </div>
              <Link href="/matches" className="mt-4 block rounded-xl border border-white/10 py-3 text-center text-xs font-black tracking-wider text-zinc-300 transition hover:border-pink-400/40 hover:text-pink-300">{t.viewAllDuels}</Link>
            </div>
          </div>
        </div>
      </section>

      <Games/>
      <Live refreshKey={refreshKey} mode="waiting" showFilters/>
      <CreateMatch onCreated={()=>setRefreshKey(v=>v+1)}/>
      <TopSkins/>

      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <div className="grid gap-5 lg:grid-cols-2">
          <HowItWorks/>
          <div className="panel rounded-3xl p-7 sm:p-9">
            <span className="pill">{t.fairPlay}</span>
            <h2 className="mt-4 text-3xl font-black uppercase">{t.gameDecides}<br/><span className="text-pink-400">{t.notSiteButton}</span></h2>
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
    <footer className="border-t border-white/5 py-8 text-center text-sm text-zinc-600">DUELPLAY · CS2 1V1 · 2026</footer>
  </div>
}

function Stat({value,label}:{value:string;label:string}){return <div className="panel rounded-2xl border-white/10 bg-black/30 p-4"><div className="text-2xl font-black text-pink-400">{value}</div><div className="mt-1 text-[10px] uppercase tracking-wider text-zinc-500">{label}</div></div>}
function HowItWorks(){const{t}=useLanguage();return <div className="panel rounded-3xl p-7 sm:p-9"><span className="pill">{t.howItWorks}</span><h2 className="mt-4 text-3xl font-black uppercase">{t.fromDuelToWin}<br/><span className="text-pink-400">{t.toVictory}</span></h2><div className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-2">{[["01",t.createMatch,t.chooseMap],["02",t.findOpponent,t.friendJoins],["03",t.playDuel,t.connectCS2],["04",t.getWinnings,t.serverConfirms]].map(([n,x,d])=><div key={n} className="group rounded-2xl border border-white/5 bg-white/[.025] p-4 transition hover:-translate-y-0.5 hover:border-pink-400/20"><div className="flex items-center gap-3"><span className="grid h-8 w-8 place-items-center rounded-lg bg-pink-400/10 text-xs font-black text-pink-400">{n}</span><div className="font-bold">{x}</div></div><div className="mt-2 pl-11 text-xs leading-5 text-zinc-500">{d}</div></div>)}</div></div>}
function Ranking(){const [users,setUsers]=useState<any[]>([]);useEffect(()=>{fetch("/api/ranking",{cache:"no-store"}).then(r=>r.json()).then(d=>setUsers(Array.isArray(d)?d:[])).catch(()=>{})},[]);return <div className="grid gap-3 sm:grid-cols-3">{users.slice(0,3).map((u,i)=><div key={u.nickname} className={`rounded-2xl bg-white/[.03] p-4 transition hover:-translate-y-0.5 hover:bg-white/[.06] ${i===0?"ring-1 ring-pink-400/30":""}`}><div className="flex items-center gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-pink-400/10 text-sm font-black text-pink-300">#{i+1}</span><div className="min-w-0"><div className="truncate font-bold">{u.nickname}</div><div className="mt-1 text-xs text-zinc-500">Level {u.level}</div></div></div><div className="mt-4 text-xl font-black text-pink-400">{u.reputation} <span className="text-xs text-zinc-600">REP</span></div></div>)}</div>}
