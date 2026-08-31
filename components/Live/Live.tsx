"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getMatches } from "@/lib/api/matches";
import { useLanguage } from "../Common/LanguageContext";

type Match={id:string;mode:string;mapName:string|null;betAmount:string|number;status:string;game:{title:string};playerOne:{nickname:string;avatarUrl:string|null};playerTwo:{nickname:string;avatarUrl:string|null}|null};
type LobbyMode="waiting"|"active"|"all";

const MAPS=["Mirage","Dust2","Ancient","Train","Overpass","Inferno","Nuke","Anubis"] as const;
const MAP_IMAGES:Record<string,string>=Object.fromEntries(MAPS.map(m=>[m,`/images/maps/covers/${m.toLowerCase()}.jpg`]));

export default function Live({refreshKey=0,mode="all",showFilters=false}:{refreshKey?:number;mode?:LobbyMode;showFilters?:boolean}){
  const{t}=useLanguage();
  const[matches,setMatches]=useState<Match[]>([]); const[loading,setLoading]=useState(true); const[error,setError]=useState("");
  const[mapFilter,setMapFilter]=useState("ALL"); const[betFilter,setBetFilter]=useState("ALL"); const[visible,setVisible]=useState(6);
  async function load(){try{setError("");const query=mode==="waiting"?"?status=waiting":mode==="active"?"?status=active":"";const data=await getMatches(query);setMatches(Array.isArray(data)?data:[])}catch(e){setError(e instanceof Error?e.message:"Ошибка загрузки")}finally{setLoading(false)}}
  useEffect(()=>{setVisible(6);load();const timer=setInterval(load,10000);return()=>clearInterval(timer)},[refreshKey,mode]);
  const filtered=useMemo(()=>matches.filter(m=>{const amount=Number(m.betAmount);const mapOk=mapFilter==="ALL"||m.mapName===mapFilter;const betOk=betFilter==="ALL"||(betFilter==="3-10"&&amount>=3&&amount<10)||(betFilter==="10-50"&&amount>=10&&amount<50)||(betFilter==="50+"&&amount>=50);return mapOk&&betOk}),[matches,mapFilter,betFilter]);
  const shown=filtered.slice(0,visible);
  const heading=mode==="active"?t.live:mode==="waiting"?t.matches:t.matchesNow;
  const subtitle=t.liveSubtitle;
  return <section id="live" className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
    <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div><span className="pill">{mode==="active"?"LIVE LOBBY":"MATCH LOBBY"}</span><h2 className="mt-4 text-4xl font-black">{heading}</h2><p className="mt-2 text-zinc-500">{subtitle}</p></div>
      <button onClick={load} className="cursor-pointer rounded-xl border border-white/10 px-4 py-2 text-sm text-zinc-300 transition hover:border-pink-400/30 hover:bg-pink-400/5 hover:text-pink-300 active:scale-95">{t.refresh}</button>
    </div>
    {showFilters&&<div className="mb-7 panel rounded-2xl p-3"><div className="flex flex-wrap gap-2"><Filter active={mapFilter==="ALL"} onClick={()=>{setMapFilter("ALL");setVisible(6)}}>{t.allMaps}</Filter>{MAPS.map(m=><Filter key={m} active={mapFilter===m} onClick={()=>{setMapFilter(m);setVisible(6)}}>{m}</Filter>)}</div><div className="mt-2 flex flex-wrap gap-2 border-t border-white/5 pt-3"><Filter active={betFilter==="ALL"} onClick={()=>{setBetFilter("ALL");setVisible(6)}}>{t.allBets}</Filter><Filter active={betFilter==="3-10"} onClick={()=>{setBetFilter("3-10");setVisible(6)}}>$3–10</Filter><Filter active={betFilter==="10-50"} onClick={()=>{setBetFilter("10-50");setVisible(6)}}>$10–50</Filter><Filter active={betFilter==="50+"} onClick={()=>{setBetFilter("50+");setVisible(6)}}>$50+</Filter></div></div>}
    {loading?<div className="panel p-10 text-center text-zinc-500">{t.loading}</div>:error?<div className="panel border-red-400/20 p-8 text-center text-red-300">{error}</div>:shown.length===0?<div className="panel p-12 text-center"><div className="text-4xl">🎮</div><h3 className="mt-3 text-xl font-bold">{mode==="active"?t.activeNo:t.noMatches}</h3><p className="mt-2 text-zinc-500">{mode==="active"?t.activeHint:t.firstMatch}</p>{mode==="active"&&<Link href="/matches" className="mt-5 inline-flex rounded-xl border border-pink-400/25 bg-pink-400/[.05] px-4 py-2 text-sm font-bold text-pink-300 transition hover:bg-pink-400/[.1]">{t.openDuels}</Link>}</div>:<><div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{shown.map(m=><MatchCard key={m.id} match={m} activeMode={mode==="active"} onJoin={load}/>)}</div>{visible<filtered.length&&<div className="mt-8 text-center"><button onClick={()=>setVisible(v=>Math.min(v+6,filtered.length))} className="cursor-pointer rounded-2xl border border-white/10 bg-white/[.03] px-6 py-3 font-bold transition hover:border-pink-400/30 hover:bg-pink-400/5 hover:text-pink-300">{t.showMore} · {filtered.length-visible}</button></div>}{visible>6&&<div className="mt-4 flex justify-end"><button onClick={()=>{setVisible(6);document.getElementById("live")?.scrollIntoView({behavior:"smooth",block:"start"})}} className="cursor-pointer rounded-xl border border-white/10 px-4 py-2 text-xs font-bold text-zinc-400 transition hover:border-pink-400/30 hover:bg-pink-400/5 hover:text-pink-200">{t.hide} ↑</button></div>}</>}
  </section>
}

function Filter({active,onClick,children}:{active:boolean;onClick:()=>void;children:React.ReactNode}){return <button onClick={onClick} className={`cursor-pointer rounded-xl px-3 py-2 text-xs font-bold transition ${active?"bg-pink-400 text-black":"bg-white/[.035] text-zinc-400 hover:bg-white/[.07] hover:text-white"}`}>{children}</button>}

function MatchCard({match,onJoin,activeMode}:{match:Match;onJoin:()=>void;activeMode:boolean}){
  const{t}=useLanguage();const[busy,setBusy]=useState(false);const[msg,setMsg]=useState("");const amount=Number(match.betAmount);const full=Boolean(match.playerTwo);const pot=amount*(full?2:1);const image=MAP_IMAGES[match.mapName||""]||MAP_IMAGES.Mirage;
  async function join(){setBusy(true);setMsg("");try{const r=await fetch(`/api/matches/${match.id}/join`,{method:"POST"});const d=await r.json();if(!r.ok)throw new Error(d.error);setMsg(t.bothReady);onJoin()}catch(e){setMsg(e instanceof Error?e.message:"Не удалось присоединиться")}finally{setBusy(false)}}
  return <article className="panel group overflow-hidden rounded-2xl border-white/[.07] transition duration-200 hover:-translate-y-1 hover:border-pink-400/30 hover:shadow-[0_18px_60px_rgba(0,0,0,.28)]">
    <Link href={`/matches/${match.id}`} className="block cursor-pointer">
      <div className="relative aspect-[16/9] overflow-hidden bg-zinc-950"><Image src={image} alt={match.mapName||"CS2 map"} fill sizes="(max-width: 768px) 100vw,(max-width:1280px) 50vw,33vw" className="object-cover object-center transition duration-500 group-hover:scale-[1.035]"/><div className="absolute inset-0 bg-gradient-to-t from-[#080a0e] via-black/10 to-transparent"/>
        <div className="absolute left-4 top-4 flex items-center gap-2"><Avatar name={match.playerOne.nickname} url={match.playerOne.avatarUrl}/><span className="rounded-full bg-black/65 px-2.5 py-1 text-[10px] font-black tracking-wider text-white backdrop-blur">{full?"2/2":"1/2"} {t.players}</span></div>
        <span className={`absolute right-4 top-4 status ${full||activeMode?"live":"waiting"}`}>{full?t.ready:activeMode?"LIVE":t.waiting}</span>
        <div className="absolute bottom-4 left-4"><div className="text-[10px] uppercase tracking-[.18em] text-pink-300">Counter-Strike 2</div><div className="mt-1 text-2xl font-black">{match.mapName}</div></div>
      </div>
      <div className="p-4"><div className="grid grid-cols-2 gap-3"><Info label={t.game} value={match.game.title}/><Info label={t.bet} value={`$${amount.toFixed(2)}`} cyan/></div><div className="mt-3 flex items-center justify-between text-sm"><span className="text-zinc-500">{t.pot}</span><b>${pot.toFixed(2)}</b></div></div>
    </Link>
    <div className="px-4 pb-4">{activeMode?<Link href={`/matches/${match.id}`} className="block w-full cursor-pointer rounded-xl bg-white/5 py-3 text-center text-sm font-bold transition hover:bg-pink-400 hover:text-black">{t.openMatch}</Link>:<button onClick={join} disabled={full||busy} className="w-full cursor-pointer rounded-xl bg-white/5 py-3 text-sm font-bold transition hover:bg-pink-400 hover:text-black active:scale-[.99] disabled:cursor-not-allowed disabled:opacity-40">{busy?t.joining:full?t.full:t.join}</button>}{msg&&<div className="mt-3 text-xs text-pink-300">{msg}</div>}</div>
  </article>
}
function Avatar({name,url}:{name:string;url:string|null}){return <div className="grid aspect-square h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-xl border border-white/15 bg-black font-black text-pink-300 backdrop-blur"><img src={url||"/avatars/premium/01-cyan.svg"} alt={name} className="avatar-square" onError={e=>{e.currentTarget.src="/avatars/premium/01-cyan.svg"}}/></div>}
function Info({label,value,cyan}:{label:string;value:string;cyan?:boolean}){return <div className="rounded-xl bg-white/[.04] p-3"><div className="text-[11px] text-zinc-500">{label}</div><div className={`mt-1 truncate font-bold ${cyan?"text-pink-400":""}`}>{value}</div></div>}
