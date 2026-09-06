"use client";
import { useEffect, useState } from "react";

type Plan = { days: number; price: number; label: string };
type Data = { subscription: { endsAt: string; active: boolean } | null; status: { active: boolean; endsAt: string | null; remainingMs: number }; plans: Record<string, Plan> };

export default function Prime() {
  const [data, setData] = useState<Data | null>(null);
  const [selected, setSelected] = useState("MONTH");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function load() {
    const r = await fetch("/api/prime", { cache: "no-store" });
    if (r.ok) setData(await r.json());
  }
  useEffect(() => { load(); }, []);

  async function act() {
    if (busy) return;
    setBusy(true); setMsg("");
    const key = sessionStorage.getItem("duelplay:prime:purchase-key") || crypto.randomUUID();
    sessionStorage.setItem("duelplay:prime:purchase-key", key);
    try {
      const r = await fetch("/api/prime", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ plan: selected }),
      });
      const x = await r.json();
      if (!r.ok) { setMsg(x.error || "Could not activate Prime"); return; }
      setMsg(x.idempotent ? "Purchase restored" : "Prime activated");
      sessionStorage.removeItem("duelplay:prime:purchase-key");
      setData(x);
    } finally { setBusy(false); }
  }

  const active = Boolean(data?.status.active);
  return <main className="mx-auto min-h-screen max-w-5xl px-4 pb-20 pt-28">
    <section className="panel rounded-3xl p-7 sm:p-10">
      <span className="pill">DUELPLAY PRIME</span>
      <h1 className="mt-4 text-4xl font-black">Prime</h1>
      <p className="mt-3 text-zinc-500">Cosmetic and service perks only. No gameplay advantage.</p>
      {active && data?.status.endsAt && <div className="mt-5 rounded-2xl border border-pink-400/20 bg-pink-400/5 p-4"><b>Prime active</b><div className="text-sm text-zinc-400">Valid until {new Date(data.status.endsAt).toLocaleString()}</div></div>}
      <div className="mt-7 grid gap-3 sm:grid-cols-3">
        {Object.entries(data?.plans ?? {}).map(([id, plan]) => <button key={id} onClick={() => setSelected(id)} className={`rounded-2xl border p-5 text-left ${selected === id ? "border-pink-400" : "border-white/10"}`}><b>{id}</b><div className="mt-2 text-2xl font-black">${plan.price.toFixed(2)}</div><div className="text-sm text-zinc-500">{plan.label}</div></button>)}
      </div>
      <button disabled={busy} onClick={act} className="mt-6 rounded-xl bg-pink-400 px-5 py-3 font-black text-black disabled:opacity-50">{busy ? "Processing…" : `Activate ${data?.plans?.[selected]?.label ?? "Prime"} · $${(data?.plans?.[selected]?.price ?? 0).toFixed(2)}`}</button>
      {msg && <p className="mt-3 text-pink-300">{msg}</p>}
    </section>
  </main>;
}
