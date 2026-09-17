"use client";
import { useEffect, useMemo, useState } from "react";

type Reward = { day: number; reward: any; active: boolean };
type Claim = { id: string; cycle: number; day: number; claimDate: string; claimedAt: string; reward: any };

function rewardLabel(reward: any) {
  if (!reward || typeof reward !== "object") return "Reward";
  if (reward.xp) return `+${reward.xp} XP`;
  if (reward.balance || reward.coins) return `+${reward.balance ?? reward.coins} coins`;
  if (reward.case || reward.caseId || reward.caseSlug) return "🎁 Case";
  if (reward.cosmetic || reward.cosmeticItemId) return "✨ Cosmetic";
  return "Reward";
}

export default function LoginRewards() {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const r = await fetch("/api/login-rewards", { cache: "no-store" });
    const x = await r.json();
    setData(x);
  }

  async function claim() {
    if (busy || !data?.canClaim) return;
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/login-rewards", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const x = await r.json();
      if (!r.ok) { setError(x.error || "Could not claim reward"); return; }
      await load();
    } finally { setBusy(false); }
  }

  useEffect(() => { load(); }, []);

  const rewards: Reward[] = data?.rewards ?? [];
  const claimed: Claim[] = data?.claimed ?? [];
  const claimedKeys = useMemo(() => new Set(claimed.map((x) => `${x.cycle}:${x.day}`)), [claimed]);
  const nextDay = data?.nextDay ?? 1;
  const cycle = data?.currentCycle ?? 1;

  return <main className="mx-auto min-h-screen max-w-5xl px-4 pb-20 pt-28">
    <section className="panel rounded-3xl p-7 sm:p-10">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div><span className="pill">LOGIN REWARDS</span><h1 className="mt-4 text-4xl font-black">30 Day Login Rewards</h1><p className="mt-2 text-sm text-zinc-500">Cycle {cycle} · Day {nextDay}</p></div>
        <button disabled={!data?.canClaim || busy} onClick={claim} className="rounded-xl bg-pink-400 px-5 py-3 font-black text-black disabled:cursor-not-allowed disabled:opacity-40">
          {busy ? "Claiming…" : data?.canClaim ? `Claim Day ${nextDay}` : "Claimed today ✓"}
        </button>
      </div>
      {error && <p className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-300">{error}</p>}
      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rewards.map((reward) => <div key={reward.day} className={`rounded-2xl border p-4 ${reward.day === nextDay ? "border-pink-400/50" : "border-white/5"}`}>
          <div className="flex items-center justify-between"><span className="text-xs font-bold text-zinc-500">DAY {reward.day}</span><span className="text-xs">{claimedKeys.has(`${cycle}:${reward.day}`) ? "✓ Claimed" : reward.day === nextDay ? "Next" : ""}</span></div>
          <div className="mt-3 text-lg font-black">{rewardLabel(reward.reward)}</div>
        </div>)}
      </div>
      <div className="mt-8 rounded-2xl bg-black/20 p-5">
        <h2 className="font-bold">Recent claims</h2>
        <div className="mt-3 space-y-2">{claimed.slice(0, 10).map((x) => <div key={x.id} className="flex justify-between text-sm"><span>Cycle {x.cycle} · Day {x.day}</span><span className="text-zinc-500">{x.claimDate}</span></div>)}</div>
      </div>
    </section>
  </main>;
}
