"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import Header from "@/components/Header/Header";
import { useLanguage } from "@/components/Common/LanguageContext";

const MAP_IMAGES:Record<string,string>={
  Mirage:"/images/maps/covers/mirage.jpg",Dust2:"/images/maps/covers/dust2.jpg",Ancient:"/images/maps/covers/ancient.jpg",
  Train:"/images/maps/covers/train.jpg",Overpass:"/images/maps/covers/overpass.jpg",Inferno:"/images/maps/covers/inferno.jpg",
  Nuke:"/images/maps/covers/nuke.jpg",Anubis:"/images/maps/covers/anubis.jpg"
};

type Match={id:string;playerOneId:string;playerTwoId:string|null;status:string;mode:string;mapName:string|null;betAmount:string|number;commission:string|number;
  playerOne:{nickname:string;avatarUrl:string|null};playerTwo:{nickname:string;avatarUrl:string|null}|null;winner?:{nickname:string}|null;
  serverConfig?:{connectUrl?:string|null;status?:string}|null;startedAt?:string|null;endedAt?:string|null};

export default function MatchPage({params}:{params:Promise<{id:string}>}){
  const {t}=useLanguage();
  const [id,setId]=useState("");
  const [m,setM]=useState<Match|null>(null);
  const [user,setUser]=useState<any>(null);
  const [msg,setMsg]=useState("");
  const [busy,setBusy]=useState(false);

  useEffect(()=>{params.then(p=>setId(p.id))},[params]);

  async function load(){
    if(!id)return;
    try{
      const [mr,ur]=await Promise.all([fetch(`/api/matches/${id}`,{cache:"no-store"}),fetch("/api/auth/me",{cache:"no-store"})]);
      const md=await mr.json(), ud=await ur.json();
      if(!mr.ok)throw new Error(md.error||"Не удалось загрузить матч");
      setM(md.match??md); setUser(ud.user??null);
    }catch(e){setMsg(e instanceof Error?e.message:"Не удалось загрузить матч")}
  }

  useEffect(()=>{load()},[id]);
  useEffect(()=>{
    if(!id)return;
    const timer=setInterval(load,3000);
    return()=>clearInterval(timer);
  },[id]);

  async function start(){
    setBusy(true);setMsg("");
    try{
      const r=await fetch(`/api/matches/${id}/start`,{method:"POST"});
      const d=await r.json();
      if(!r.ok)throw new Error(d.error||"Не удалось запустить матч");
      setM(d.match??d);
      setMsg(t.matchStarted);
    }catch(e){setMsg(e instanceof Error?e.message:"Не удалось запустить матч")}
    finally{setBusy(false)}
  }

  async function cancel(){
    setBusy(true);setMsg("");
    try{
      const r=await fetch(`/api/matches/${id}/cancel`,{method:"POST"});
      const d=await r.json();
      if(!r.ok)throw new Error(d.error||"Не удалось отменить матч");
      setM(d.match??d);
    }catch(e){setMsg(e instanceof Error?e.message:"Не удалось отменить матч")}
    finally{setBusy(false)}
  }

  if(!m)return <><Header/><main className="min-h-screen pt-28 text-center text-zinc-500">{t.loading}</main></>;

  const pot=Number(m.betAmount)*(m.playerTwo?2:1);
  const payout=pot-Number(m.commission??pot*.10);
  const participant=Boolean(user&&[m.playerOneId,m.playerTwoId].includes(user.id));
  const mapImage=MAP_IMAGES[m.mapName||""];

  return <><Header/><main className="mx-auto min-h-screen max-w-5xl px-4 pb-20 pt-24 sm:px-6">
    <div className="mb-4 flex items-center justify-between gap-3">
      <Link href="/matches" className="text-sm font-bold text-zinc-500 transition hover:text-pink-300">{t.backMatches}</Link>
      <span className={`status ${m.status==="LIVE"?"live":"waiting"}`}>{m.status}</span>
    </div>

    <section className="panel overflow-hidden rounded-3xl">
      <div className="relative h-64 sm:h-80">
        {mapImage&&<Image src={mapImage} alt={m.mapName||"CS2 map"} fill sizes="(max-width:1024px) 100vw, 960px" className="object-cover"/>}
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,5,7,.92),rgba(5,5,7,.25),rgba(5,5,7,.92))]"/>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,47,145,.16),transparent_40%)]"/>
        <div className="absolute inset-x-6 bottom-7 text-center sm:inset-x-12">
          <div className="text-xs font-black tracking-[.25em] text-pink-300">CS2 · 1V1 DUEL</div>
          <h1 className="mt-3 text-3xl font-black sm:text-5xl">{m.playerOne.nickname} <span className="mx-2 text-pink-400">VS</span> {m.playerTwo?.nickname??t.waitingOpponent}</h1>
        </div>
      </div>

      <div className="p-6 sm:p-9">
        <div className="grid gap-3 sm:grid-cols-3">
          <Info a={t.map.toUpperCase()} b={m.mapName??"—"}/>
          <Info a={t.bet.toUpperCase()} b={`$${Number(m.betAmount).toFixed(2)}`}/>
          <Info a={t.pot.toUpperCase()} b={`$${pot.toFixed(2)}`}/>
        </div>

        {m.status==="READY"&&<div className="mt-6 rounded-2xl border border-pink-400/20 bg-pink-400/[.05] p-5">
          <div className="text-sm font-black text-pink-300">{t.bothReady}</div>
          <p className="mt-2 text-sm leading-6 text-zinc-400">{t.productionNote}</p>
        </div>}

        {m.status==="LIVE"&&<div className="mt-6 rounded-2xl border border-green-400/20 bg-green-400/[.05] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><div className="text-sm font-black text-green-300">{t.matchRunning}</div><p className="mt-1 text-sm text-zinc-500">{t.serverResult}</p></div>
            <span className="status live">LIVE</span>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <a href="steam://run/730" className="rounded-xl bg-pink-400 px-5 py-3 text-sm font-black text-black transition hover:bg-pink-300 active:scale-95">{t.openCS2}</a>
            {m.serverConfig?.connectUrl&&<a href={m.serverConfig.connectUrl} className="rounded-xl border border-green-400/25 bg-green-400/[.06] px-5 py-3 text-sm font-black text-green-300 transition hover:bg-green-400/10 active:scale-95">{t.connectServer}</a>}
          </div>
          {!m.serverConfig?.connectUrl&&<p className="mt-4 text-xs text-zinc-600">{t.serverPending}</p>}
        </div>}

        {m.status==="FINISHED"&&<div className="mt-6 rounded-2xl border border-green-400/20 bg-green-400/[.05] p-5 text-sm text-green-300">{t.winner}: <b>{m.winner?.nickname}</b> · {t.payout} ${payout.toFixed(2)}</div>}
        {m.status==="CANCELLED"&&<div className="mt-6 rounded-2xl border border-white/10 bg-white/[.03] p-5 text-sm text-zinc-400">{t.cancelled}</div>}
        {msg&&<div aria-live="polite" className="mt-5 rounded-xl border border-white/10 bg-white/[.03] p-4 text-sm text-pink-300">{msg}</div>}

        <div className="mt-7 flex flex-wrap gap-3">
          {participant&&m.status==="READY"&&<button disabled={busy} onClick={start} className="rounded-2xl bg-pink-400 px-6 py-4 font-black text-black transition hover:bg-pink-300 active:scale-95 disabled:opacity-50">{busy?"…":t.startMatch}</button>}
          {participant&&["WAITING_FOR_PLAYERS","READY"].includes(m.status)&&user?.id===m.playerOneId&&<button disabled={busy} onClick={cancel} className="cancel-match rounded-2xl border border-red-400/20 px-5 py-3 font-bold text-red-300 transition">{t.cancel}</button>}
          {participant&&m.status==="LIVE"&&!m.serverConfig?.connectUrl&&user?.id===m.playerOneId&&<button disabled={busy} onClick={cancel} className="cancel-match rounded-2xl border border-red-400/20 px-5 py-3 font-bold text-red-300 transition">{t.matchTestCancel}</button>}
        </div>

        <div className="mt-8 border-t border-white/5 pt-6 text-xs leading-6 text-zinc-600">
          <b className="text-zinc-400">{t.finished}:</b> {t.productionNote}
        </div>
      </div>
    </section>
  </main></>
}

function Info({a,b}:{a:string;b:string}){return <div className="rounded-2xl border border-white/5 bg-white/[.025] p-5"><div className="text-[10px] font-black tracking-wider text-zinc-600">{a}</div><div className="mt-2 text-xl font-black text-white">{b}</div></div>}
