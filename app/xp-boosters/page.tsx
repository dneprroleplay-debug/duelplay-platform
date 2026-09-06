"use client";
import { useEffect, useMemo, useState } from "react";

type Plan = { multiplier: number; hours: number; price: number };
type Booster = { id: string; multiplier: number | string; startsAt: string; endsAt: string; active: boolean };

export default function Boosters() {
  const [plans, setPlans] = useState<Record<string, Plan>>({});
  const [boosters, setBoosters] = useState<Booster[]>([]);
  const [selected, setSelected] = useState("2x24");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await fetch("/api/xp-boosters", { cache: "no-store" });
    if (!r.ok) return;
    const data = await r.json();
    setPlans(data.plans || {});
    setBoosters(data.boosters || []);
  }

  useEffect(() => { void load(); }, []);

  const active = useMemo(() => boosters.find((x) => x.active && new Date(x.endsAt).getTime() > Date.now()), [boosters]);

  async function activate() {
    if (busy || active) return;
    setBusy(true);
    setMsg("");
    const keyName = "duelplay:xp-booster:idempotency-key";
    let key = sessionStorage.getItem(keyName);
    if (!key) {
      key = crypto.randomUUID();
      sessionStorage.setItem(keyName, key);
    }
    try {
      const r = await fetch("/api/xp-boosters", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ plan: selected }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(data.error || "Could not activate booster");
        return;
      }
      sessionStorage.removeItem(keyName);
      setMsg(data.idempotent ? "Booster purchase recovered" : "XP booster activated");
      await load();
    } catch {
      setMsg("Connection lost. Your request is safe to retry.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="mx-auto min-h-screen max-w-5xl px-4 pb-20 pt-28">
    <section className="panel rounded-3xl p-7 sm:p-10">
      <span className="pill">XP BOOSTERS</span>
      <h1 className="mt-4 text-4xl font-black">Progress boosters</h1>
      <p className="mt-3 max-w-2xl text-white/60">Boosters multiply earned XP, including DuelPass XP. Only one active booster is allowed at a time.</p>
      <div className="mt-7 grid gap-3 sm:grid-cols-3">
        {Object.entries(plans).map(([id, plan]) => <button key={id} onClick={() => setSelected(id)} disabled={busy || Boolean(active)} className={`rounded-2xl border p-4 text-left ${selected === id ? "border-pink-400" : "border-white/10"}`}>
          <div className="text-xl font-black">{plan.multiplier}× XP</div>
          <div className="mt-1 text-sm text-white/60">{plan.hours} hours · {plan.price} balance</div>
        </button>)}
      </div>
      <button onClick={activate} disabled={busy || Boolean(active)} className="mt-6 rounded-xl bg-pink-400 px-5 py-3 font-black text-black disabled:opacity-50">
        {busy ? "Processing…" : active ? `Active until ${new Date(active.endsAt).toLocaleString()}` : "Activate selected booster"}
      </button>
      {msg && <p className="mt-3 text-pink-300">{msg}</p>}
      <div className="mt-8 space-y-2">
        {boosters.map((x) => <div key={x.id} className="rounded-xl border border-white/5 p-4">
          <div className="font-bold">{Number(x.multiplier)}× XP {x.active && new Date(x.endsAt).getTime() > Date.now() ? "· ACTIVE" : "· EXPIRED"}</div>
          <div className="text-sm text-white/50">{new Date(x.startsAt).toLocaleString()} → {new Date(x.endsAt).toLocaleString()}</div>
        </div>)}
      </div>
    </section>
  </main>;
}
