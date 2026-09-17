"use client";
import { useCallback, useEffect, useState } from "react";

type Collection = { id: string; name: string; description?: string | null; requirements: { name: string; quantity: number }[]; reward?: Record<string, unknown> | null; matched: number; totalRequired: number; remaining: number; progress: number; completed: boolean; claimed: boolean; claimedAt: string | null };

export default function Collections() {
  const [data, setData] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const r = await fetch("/api/collections", { cache: "no-store" });
      const x = await r.json();
      if (!r.ok) throw new Error(x.error || "Failed to load collections");
      setData(Array.isArray(x) ? x : []);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load collections"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function claim(c: Collection) {
    if (!c.completed || c.claimed || busy) return;
    setBusy(c.id); setError(""); setNotice("");
    const key = `collection:${c.id}:${crypto.randomUUID()}`;
    try {
      const r = await fetch("/api/collections", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify({ collectionId: c.id }) });
      const x = await r.json();
      if (!r.ok) throw new Error(x.error || "Unable to claim collection");
      setNotice(`Collection claimed: ${c.name}`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to claim collection"); await load(); }
    finally { setBusy(null); }
  }

  return <main className="mx-auto min-h-screen max-w-6xl px-4 pb-20 pt-28"><section className="panel rounded-3xl p-7 sm:p-10"><div className="flex flex-wrap items-end justify-between gap-4"><div><span className="pill">COLLECTIONS</span><h1 className="mt-4 text-4xl font-black">Collections</h1><p className="mt-2 text-zinc-500">Complete item sets to unlock one-time rewards.</p></div><div className="text-sm text-zinc-500">{data.filter(c => c.claimed).length} / {data.length} claimed</div></div>
    {notice && <div className="mt-6 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4 text-sm text-emerald-300">{notice}</div>}
    {error && <div className="mt-6 rounded-2xl border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-300">{error}</div>}
    {loading ? <div className="mt-8 p-10 text-center text-zinc-500">Loading…</div> : !data.length ? <div className="mt-8 rounded-2xl border border-white/5 p-10 text-center text-zinc-500">No collections available.</div> : <div className="mt-8 grid gap-4 md:grid-cols-2">{data.map(c => <article key={c.id} className="rounded-2xl border border-white/5 bg-white/[.02] p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-black">{c.name}</h2><p className="mt-1 text-sm text-zinc-500">{c.description || "Collect the required items to unlock the reward."}</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${c.claimed ? "bg-emerald-400/10 text-emerald-300" : c.completed ? "bg-pink-400/10 text-pink-300" : "bg-white/5 text-zinc-500"}`}>{c.claimed ? "CLAIMED" : c.completed ? "COMPLETE" : `${c.matched}/${c.totalRequired}`}</span></div><div className="mt-5 h-2 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-[var(--theme-accent)] transition-all" style={{ width: `${Math.min(100, Math.round(c.progress * 100))}%` }} /></div><div className="mt-4 grid gap-2">{c.requirements.map(r => <div key={r.name} className="flex items-center justify-between rounded-xl bg-white/[.025] px-3 py-2 text-xs"><span className="truncate">{r.name}</span><span className="text-zinc-500">{r.quantity}</span></div>)}</div><div className="mt-4 flex items-center justify-between gap-3"><div className="text-xs text-zinc-600">{c.claimed ? "Reward claimed" : c.reward ? `${c.remaining} item${c.remaining === 1 ? "" : "s"} remaining` : "No reward configured"}</div>{c.completed && !c.claimed && <button disabled={busy !== null} onClick={() => void claim(c)} className="rounded-xl bg-[var(--theme-accent)] px-4 py-2 text-xs font-black text-black disabled:opacity-50">{busy === c.id ? "Claiming…" : "Claim reward"}</button>}</div></article>)}</div>}
  </section></main>;
}
