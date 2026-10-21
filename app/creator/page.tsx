"use client";

import { useEffect, useState } from "react";
import { useDuelDialog } from "@/components/Common/DuelDialogProvider";

export default function Creator() {
  const dialog = useDuelDialog();
  const [d, setD] = useState<Record<string, unknown> | undefined>();

  async function tournament() {
    const r = await fetch("/api/tournaments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Creator Cup", maxPlayers: 32, entryFee: 0, prizePool: 0, startsAt: new Date(Date.now() + 3600000).toISOString() }),
    });
    const body = await r.json().catch(() => ({}));
    await dialog.alert({ title: "Tournament", message: r.ok ? "Tournament created" : body.error || "Error" });
  }

  async function request() {
    const raw = await dialog.prompt({ title: "Creator payout", message: "Payout amount", placeholder: "0.00", confirmText: "Request payout", cancelText: "Cancel" });
    if (raw === null) return;
    const amount = Number(raw);
    if (!(amount > 0)) {
      await dialog.alert({ title: "Creator payout", message: "Enter a valid payout amount." });
      return;
    }
    const r = await fetch("/api/creator", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "requestPayout", amount }),
    });
    const body = await r.json().catch(() => ({}));
    await dialog.alert({ title: "Creator payout", message: r.ok ? "Payout requested" : body.error || "Error" });
  }

  useEffect(() => {
    fetch("/api/creator", { cache: "no-store" }).then(r => r.json()).then(setD);
  }, []);

  return <main className="mx-auto min-h-screen max-w-5xl px-4 pb-20 pt-28">
    <section className="panel rounded-3xl p-7 sm:p-10">
      <span className="pill">CREATOR HUB</span>
      <h1 className="mt-4 text-4xl font-black">Creator / Streamer</h1>
      <p className="mt-3 text-zinc-500">Profile, referral, commission and payout history.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button onClick={tournament} className="rounded-xl border border-white/10 px-5 py-3 font-black">Create tournament</button>
        <button onClick={request} className="rounded-xl bg-pink-400 px-5 py-3 font-black text-black">Request payout</button>
      </div>
      <pre className="mt-8 overflow-auto rounded-2xl bg-black/30 p-5 text-xs text-zinc-400">{JSON.stringify(d, null, 2)}</pre>
    </section>
  </main>;
}
