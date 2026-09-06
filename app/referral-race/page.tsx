"use client";
import {useEffect,useState} from "react";

type Row={id:string;nickname:string;avatarUrl?:string|null;code:string;invited:number;position:number;prize:number};
export default function ReferralRacePage(){
  const [d,setD]=useState<{month:string;prizes:number[];settled:boolean;leaderboard:Row[]}|null>(null);
  useEffect(()=>{let live=true;let loading=false;const load=async()=>{if(!live||document.visibilityState==="hidden"||loading)return;loading=true;try{const r=await fetch("/api/referral-race",{cache:"no-store"});const x=await r.json();if(live&&r.ok)setD(x)}catch{}finally{loading=false}};void load();const timer=setInterval(()=>void load(),30000);const onVisibility=()=>{if(document.visibilityState==="visible")void load()};document.addEventListener("visibilitychange",onVisibility);return()=>{live=false;clearInterval(timer);document.removeEventListener("visibilitychange",onVisibility)}},[]);
  if(!d)return <main className="pt-28 text-center text-zinc-500">Loading…</main>;
  return <main className="mx-auto min-h-screen max-w-5xl px-4 pb-20 pt-28">
    <section className="panel rounded-3xl p-7 sm:p-10">
      <div className="flex flex-wrap items-center justify-between gap-3"><span className="pill">REFERRAL RACE</span><span className="text-xs text-zinc-500">{d.settled?"SETTLED":"LIVE"}</span></div>
      <h1 className="mt-4 text-4xl font-black">Monthly Referral Race</h1>
      <p className="mt-2 text-zinc-500">{d.month} · active new invited players count toward the leaderboard.</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">{d.prizes.map((prize,i)=><div key={prize} className="rounded-2xl border border-white/10 bg-white/[.025] p-4"><div className="text-xs text-zinc-500">#{i+1} PRIZE</div><div className="mt-1 text-2xl font-black">${prize}</div></div>)}</div>
      <div className="mt-8 space-y-2">{d.leaderboard.length?d.leaderboard.map(x=><div key={x.id} className="flex items-center gap-4 rounded-2xl bg-white/[.025] p-4"><b className="w-10 text-pink-400">#{x.position}</b><div className="flex-1 min-w-0"><b className="truncate">{x.nickname}</b><div className="text-xs text-zinc-600">{x.code}</div></div><div className="text-right"><strong>{x.invited} invited</strong>{x.prize>0&&<div className="text-xs text-emerald-400">Prize ${x.prize}</div>}</div></div>):<div className="rounded-2xl bg-white/[.025] p-6 text-center text-zinc-500">No qualifying referrals yet.</div>}</div>
    </section>
  </main>;
}
