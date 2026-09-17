'use client';
import { useEffect, useState } from 'react';

export default function Achievements() {
  const [d, setD] = useState<any>();
  useEffect(() => { fetch('/api/achievements', { cache: 'no-store' }).then(r => r.json()).then(setD); }, []);
  const list = d?.achievements || [];
  return <main className="mx-auto min-h-screen max-w-5xl px-4 pb-20 pt-28">
    <section className="panel rounded-3xl p-7 sm:p-10">
      <span className="pill">ACHIEVEMENTS</span>
      <h1 className="mt-4 text-4xl font-black">Achievements</h1>
      <p className="mt-2 text-sm text-zinc-500">Milestones are unlocked automatically from real duel activity. Rewards are granted once.</p>
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {list.map((a:any) => <div key={a.id} className={`rounded-2xl border p-5 ${a.unlocked ? 'border-pink-400/30 bg-pink-400/[.04]' : 'border-white/5 bg-white/[.02]'}`}>
          <div className="flex items-start justify-between gap-3"><div><b>{a.unlocked ? '🏆 ' : '🔒 '}{a.name}</b><p className="mt-2 text-sm text-zinc-500">{a.description}</p></div><span className="text-xs text-pink-300">+{a.xpReward} XP</span></div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-pink-400" style={{ width: `${a.progress.percent}%` }} /></div>
          <div className="mt-2 flex justify-between text-xs text-zinc-600"><span>{a.unlocked ? 'Unlocked' : `${a.progress.value} / ${a.progress.target}`}</span><span>{a.progress.percent}%</span></div>
        </div>)}
      </div>
    </section>
  </main>;
}
