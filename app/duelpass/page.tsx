"use client";
import { useEffect, useMemo, useState } from "react";

type Reward = { xp?: number; balance?: number; coins?: number; case?: string; caseId?: string; caseSlug?: string; cosmetic?: string; cosmeticItemId?: string } | null;
type Data = { pass: any; progress: any; rewards: any[]; claimedLevels?: number[]; currentReward?: Reward };

function label(reward: Reward) {
  if (!reward) return "No reward";
  const out: string[] = [];
  if (reward.xp) out.push(`${reward.xp} XP`);
  if (reward.balance || reward.coins) out.push(`${reward.balance ?? reward.coins} coins`);
  if (reward.case || reward.caseId || reward.caseSlug) out.push("Case");
  if (reward.cosmetic || reward.cosmeticItemId) out.push("Cosmetic");
  return out.join(" + ") || "Reward";
}

export default function DuelPass() {
  const [d, setD] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const load = async () => { setLoading(true); const r = await fetch('/api/duelpass',{cache:'no-store'}); const j=await r.json(); setD(j); setLoading(false); };
  useEffect(()=>{load();},[]);
  const claimed = useMemo(()=>new Set(d?.claimedLevels ?? []),[d]);
  const progressXp = Number(d?.progress?.xp ?? 0);
  const maxLevel = Number(d?.pass?.maxLevel ?? 50);
  const level = Math.min(maxLevel, Math.floor(progressXp/100)+1);
  const percent = level >= maxLevel ? 100 : Math.floor(((progressXp % 100)/100)*100);
  const action = async (action:string, level?:number) => {
    setBusy(`${action}:${level ?? ''}`); setError("");
    const key = `duelpass:${d?.pass?.id}:${action}:${level ?? ''}`;
    const r=await fetch('/api/duelpass',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({action,level})});
    const j=await r.json(); if(!r.ok) setError(j.error||'Could not complete action'); else await load(); setBusy(null);
  };
  if(loading) return <main className="mx-auto min-h-screen max-w-5xl px-4 pt-28"><div className="panel rounded-3xl p-8">Loading DuelPass…</div></main>;
  if(!d?.pass) return <main className="mx-auto min-h-screen max-w-5xl px-4 pt-28"><div className="panel rounded-3xl p-8"><span className="pill">DUELPASS</span><h1 className="mt-4 text-3xl font-black">No active pass</h1><p className="mt-2 text-zinc-500">The next seasonal pass will appear here when it starts.</p></div></main>;
  return <main className="mx-auto min-h-screen max-w-5xl px-4 pb-20 pt-28">
    <section className="panel rounded-3xl p-7 sm:p-10">
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between"><div><span className="pill">DUELPASS · {d.pass.name}</span><h1 className="mt-4 text-4xl font-black">Season Battle Pass</h1><p className="mt-2 text-zinc-500">Earn Duel XP from completed duels and unlock free or premium rewards.</p></div><button disabled={!!d.progress?.premium||!!busy} onClick={()=>action('premium')} className="rounded-xl border border-pink-400/30 px-4 py-2 font-bold">{d.progress?.premium?'PREMIUM ACTIVE':`Unlock Premium · ${Number(d.pass.premiumPrice)}`}</button></div>
      <div className="mt-8 rounded-2xl border border-white/10 p-5"><div className="flex justify-between text-sm"><b>Level {level}/{maxLevel}</b><span>{progressXp} Duel XP</span></div><div className="mt-3 h-3 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-pink-500" style={{width:`${percent}%`}} /></div><p className="mt-2 text-xs text-zinc-500">{level>=maxLevel?'Max level reached':`${100-(progressXp%100)} XP to next level`}</p></div>
      {error&&<div className="mt-5 rounded-xl border border-red-400/20 bg-red-400/5 p-3 text-sm text-red-300">{error}</div>}
      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{(d.rewards||[]).map((row:any)=>{const lv=Number(row.level); const unlocked=level>=lv; const done=claimed.has(lv); const reward=(d.progress?.premium ? (row.premium??row.free??row.reward) : (row.free??row.reward)); return <div key={lv} className="rounded-2xl border border-white/10 p-4"><div className="flex justify-between"><b>Level {lv}</b><span className="text-xs text-zinc-500">{unlocked?'UNLOCKED':'LOCKED'}</span></div><div className="mt-4 text-sm">{label(reward)}</div><button disabled={!unlocked||done||busy===`claim:${lv}`} onClick={()=>action('claim',lv)} className="mt-4 w-full rounded-xl border border-white/10 px-3 py-2 text-sm font-bold disabled:opacity-40">{done?'CLAIMED':unlocked?'CLAIM REWARD':'LOCKED'}</button></div>})}</div>
    </section>
  </main>;
}
