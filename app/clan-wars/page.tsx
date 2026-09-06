"use client";
import { useEffect, useState } from "react";

export default function ClanWarsPage() {
  const [wars, setWars] = useState<any[]>([]);
  const [clans, setClans] = useState<any[]>([]);
  const [mine, setMine] = useState<any>(null);
  const [one, setOne] = useState("");
  const [two, setTwo] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    const [w, c, m] = await Promise.all([
      fetch("/api/clan-wars", { cache: "no-store" }),
      fetch("/api/clans", { cache: "no-store" }),
      fetch("/api/clans?mine=1", { cache: "no-store" }),
    ]);
    setWars(w.ok ? await w.json() : []); setClans(c.ok ? await c.json() : []); setMine(m.ok ? await m.json() : null);
  }
  useEffect(() => { void load(); }, []);
  async function create() {
    setBusy(true); setMsg("");
    try { const r = await fetch("/api/clan-wars", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", clanOneId: one, clanTwoId: two }) }); const d = await r.json(); setMsg(r.ok ? "War created" : d.error || "Failed"); if (r.ok) { setOne(""); setTwo(""); await load(); } } finally { setBusy(false); }
  }
  async function state(action: string, id: string, winnerClanId?: string) {
    setBusy(true); setMsg("");
    try { const r = await fetch("/api/clan-wars", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id, winnerClanId }) }); const d = await r.json(); setMsg(r.ok ? "Updated" : d.error || "Failed"); if (r.ok) await load(); } finally { setBusy(false); }
  }
  const canManage = mine?.role === "LEADER" || mine?.role === "OFFICER";
  return <main className="mx-auto min-h-screen max-w-6xl px-4 pb-20 pt-28"><section className="panel rounded-3xl p-7 sm:p-10">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><span className="pill">CLAN WARS</span><h1 className="mt-4 text-4xl font-black">Clan Wars</h1><p className="mt-2 text-sm text-zinc-500">Competitive clan-to-clan records and rating updates.</p></div><a href="/clans" className="rounded-xl border border-white/10 px-4 py-2 text-sm">Back to clans</a></div>
    {canManage && <div className="mt-7 grid gap-2 rounded-2xl border border-white/5 bg-white/[.02] p-4 sm:grid-cols-[1fr_1fr_auto]"><select className="input" value={one} onChange={e=>setOne(e.target.value)}><option value="">Clan one</option>{clans.map(c=><option key={c.id} value={c.id}>{c.name} [{c.tag}]</option>)}</select><select className="input" value={two} onChange={e=>setTwo(e.target.value)}><option value="">Clan two</option>{clans.map(c=><option key={c.id} value={c.id}>{c.name} [{c.tag}]</option>)}</select><button disabled={busy||!one||!two||one===two} onClick={create} className="rounded-xl bg-pink-400 px-5 font-black text-black disabled:opacity-50">Create war</button></div>}
    {msg&&<p className="mt-3 text-sm text-pink-300">{msg}</p>}
    <div className="mt-7 space-y-3">{wars.map(w=><article key={w.id} className="rounded-2xl border border-white/5 bg-white/[.02] p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><b>{w.clanOne.name} <span className="text-pink-400">[{w.clanOne.tag}]</span></b><span className="mx-3 text-zinc-600">vs</span><b>{w.clanTwo.name} <span className="text-pink-400">[{w.clanTwo.tag}]</span></b></div><span className="pill">{w.status}</span></div><div className="mt-2 text-xs text-zinc-500">Rating {w.clanOne.rating} vs {w.clanTwo.rating}{w.winnerClanId?` · Winner: ${w.winnerClanId}`:""}</div>{canManage&&<div className="mt-4 flex flex-wrap gap-2">{w.status==="PENDING"&&<button disabled={busy} onClick={()=>state("start",w.id)} className="rounded-lg bg-white/5 px-3 py-2 text-xs">Start</button>}{(w.status==="PENDING"||w.status==="ACTIVE")&&<><button disabled={busy} onClick={()=>state("finish",w.id,w.clanOneId)} className="rounded-lg bg-pink-400 px-3 py-2 text-xs font-bold text-black">{w.clanOne.name} wins</button><button disabled={busy} onClick={()=>state("finish",w.id,w.clanTwoId)} className="rounded-lg bg-pink-400 px-3 py-2 text-xs font-bold text-black">{w.clanTwo.name} wins</button><button disabled={busy} onClick={()=>state("cancel",w.id)} className="rounded-lg border border-white/10 px-3 py-2 text-xs">Cancel</button></>}</div>}</article>)}{!wars.length&&<div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-zinc-500">No clan wars yet.</div>}</div>
  </section></main>
}
