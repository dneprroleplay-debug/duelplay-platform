"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useLanguage } from "@/components/Common/LanguageContext";

export default function LeaguesPage(){
 const{t}=useLanguage();const[rows,setRows]=useState<any[]>([]);const[error,setError]=useState("");
 useEffect(()=>{fetch('/api/leagues',{cache:'no-store'}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error||t.genericLoadError);setRows(Array.isArray(d)?d:[])}).catch(e=>setError(e.message||t.genericLoadError))},[]);
 const title=t.leaguesTitle;
 return <main className="mx-auto min-h-screen max-w-6xl px-4 pb-20 pt-28"><section className="panel rounded-3xl p-7 sm:p-10"><span className="pill">SEASON LEAGUES</span><h1 className="mt-4 text-4xl font-black">{title}</h1><p className="mt-2 text-zinc-500">{t.leaguesText}</p>{error?<div className="mt-8 rounded-2xl border border-red-400/20 bg-red-400/5 p-8 text-center text-red-300">{error}</div>:<div className="mt-8 grid gap-3">{rows.map(x=><Link href={`/profile/${encodeURIComponent(x.nickname)}`} key={x.id} className="rounded-2xl border border-white/5 bg-white/[.025] p-4 transition hover:border-pink-400/30"><div className="flex items-center gap-4"><span className="w-10 text-pink-300">#{x.position}</span><img src={x.avatarUrl||'/avatars/premium/01-cyan.svg'} alt="" className="h-11 w-11 rounded-xl object-cover"/><div className="min-w-0 flex-1"><b className="block truncate">{x.nickname}</b><div className="mt-1 text-xs text-zinc-500">{x.leagueLabel} · {x.wins}W / {x.losses}L · 🔥 {x.streak}</div><div className="mt-3 h-1.5 max-w-sm overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-pink-400" style={{width:`${x.progress}%`}}/></div></div><div className="text-right"><strong className="text-pink-400">{x.rating}</strong><div className="text-[10px] text-zinc-600">{x.nextThreshold===null?t.max:`${x.pointsToNext} ${t.toNext}`}</div></div></div></Link>)}</div>}</section></main>
}
